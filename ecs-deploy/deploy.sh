#!/usr/bin/env bash
# ECS 배포 (DRT-7208). 트리거·라벨은 각 레포 워크플로가 정하고, 실행만 여기서 한다.
#
# 0. 입력 검증 + 동시 실행 차단 (진행 중인 배포·마이그레이션이 있으면 중단)
# 1. 서비스마다 지금 task definition 을 새 이미지로 바꾼 revision 을 등록 (아직 적용 안 함)
# 2. 마이그레이션 (migrate_mode)
#    - check : 새 이미지로 one-off `migrate --check` → 미적용이 있으면 배포 중단
#    - before: 배포 전에 `migrate`
#    - after : 배포 후에 `migrate` (DROP 류. 배포 전 확인은 하지 않음)
#    - none  : 안 함
# 3. 서비스를 순서대로 하나씩 update-service → 완료 → SETTLE 초 동안 새 task 가 죽지 않는지 확인
#    (worker·beat 는 ALB 헬스체크가 없어 "떠 있다" 만으로 완료가 되므로 이 확인이 필요하다)
# 4. 모든 서비스가 끝난 뒤에만 이미지 태그를 SSM /deploy/<env>/<app>/<kind>-image-tag 에 기록
#    (CDK 서비스 스택이 이 값을 읽는다. 실패한 배포의 태그가 남으면 다음 cdk deploy 가 그걸 올린다)
# 5. after 모드면 마이그레이션
#
# 호출 워크플로는 반드시 concurrency: {group: ecs-deploy-<app>-<env_key>, cancel-in-progress: false}
# DB 비밀번호는 러너로 가져오지 않는다 — one-off task 가 task definition 의 secrets 로 받는다.
set -euo pipefail

: "${REGION:?}" "${CLUSTER:?}" "${APP:?}" "${ENV_KEY:?}" "${SERVICES:?}" "${IMAGES:?}"
MIGRATE_MODE="${MIGRATE_MODE:-check}"
MIGRATE_SERVICE="${MIGRATE_SERVICE:-api}"
MIGRATE_COMMAND="${MIGRATE_COMMAND:-python manage.py migrate --noinput}"
CHECK_COMMAND="${CHECK_COMMAND:-python manage.py migrate --check}"
STABLE_TIMEOUT="${STABLE_TIMEOUT:-1200}"
MIGRATE_TIMEOUT="${MIGRATE_TIMEOUT:-1800}"
SETTLE_SECONDS="${SETTLE_SECONDS:-90}"
STARTED_BY="ecs-deploy-migrate"
WORK="$(mktemp -d "${RUNNER_TEMP:-/tmp}/ecs-deploy.XXXXXX")"

aws() { command aws --region "$REGION" "$@"; }
# 조회는 일시적인 API 오류(쓰로틀링 등)에 3번까지 재시도
q() { local i; for i in 1 2 3; do aws "$@" && return 0; sleep $((i * 3)); done; aws "$@"; }
trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; echo "${s%"${s##*[![:space:]]}"}"; }
fail() { echo "::error::$*"; summary; exit 1; }

# ---------- 0. 입력 검증 ----------
declare -A IMAGE_OF
IFS=',' read -ra pairs <<< "$(echo "$IMAGES" | tr '\n' ',')"
for p in "${pairs[@]}"; do
  p="$(trim "$p")"; [ -z "$p" ] && continue
  kind="${p%%=*}"; uri="${p#*=}"
  [[ "$p" == *=* && -n "$kind" ]] || { echo "::error::images 형식 오류: '$p' (kind=uri)"; exit 1; }
  [[ "$uri" != *@* && "${uri##*/}" == *:* ]] || { echo "::error::이미지는 태그 형식이어야 합니다(digest 불가): $uri"; exit 1; }
  IMAGE_OF[$kind]="$uri"
done
SVC_NAMES=(); declare -A KIND_OF NEW_TD OLD_TD
IFS=',' read -ra entries <<< "$(echo "$SERVICES" | tr '\n' ',')"
for e in "${entries[@]}"; do
  e="$(trim "$e")"; [ -z "$e" ] && continue
  svc="${e%%:*}"; kind="${e#*:}"
  [ -n "${IMAGE_OF[$kind]:-}" ] || { echo "::error::서비스 $svc 의 이미지 종류 '$kind' 가 images 에 없습니다"; exit 1; }
  SVC_NAMES+=("$svc"); KIND_OF[$svc]="$kind"
done
[ ${#SVC_NAMES[@]} -gt 0 ] || { echo "::error::services 가 비어 있습니다"; exit 1; }
case "$MIGRATE_MODE" in check|before|after|none) ;; *) echo "::error::알 수 없는 migrate_mode=$MIGRATE_MODE"; exit 1;; esac
if [ "$MIGRATE_MODE" != none ] && [ -z "${KIND_OF[$MIGRATE_SERVICE]:-}" ]; then
  echo "::error::migrate_service=$MIGRATE_SERVICE 가 services 에 없습니다"; exit 1
fi
full() { echo "${APP}-${ENV_KEY}-$1"; }

summary() {
  [ ${#OLD_TD[@]} -gt 0 ] || return 0
  echo "---- 서비스별 상태 ----"
  for svc in "${SVC_NAMES[@]}"; do
    local primary; primary=$(q ecs describe-services --cluster "$CLUSTER" --services "$(full "$svc")" \
      --query 'services[0].deployments[?status==`PRIMARY`].[taskDefinition,rolloutState]|[0]' --output text 2>/dev/null || echo "? ?")
    local td="${primary%%[[:space:]]*}" st="${primary##*[[:space:]]}" ver="?"
    [ "$td" = "${NEW_TD[$svc]:-x}" ] && ver="새 버전" ; [ "$td" = "${OLD_TD[$svc]:-x}" ] && ver="이전 버전"
    echo "$(full "$svc"): ${td##*/} ($ver, $st)"
  done
  echo "SSM 이미지 태그는 바꾸지 않았습니다 (배포가 끝까지 성공해야 기록)."
}

# 동시 실행 차단
for svc in "${SVC_NAMES[@]}"; do
  out=$(q ecs describe-services --cluster "$CLUSTER" --services "$(full "$svc")" \
    --query 'services[0].[status, length(deployments[?rolloutState==`IN_PROGRESS`])]' --output text)
  [ "${out%%[[:space:]]*}" = ACTIVE ] || { echo "::error::서비스 $(full "$svc") 가 없습니다 ($out)"; exit 1; }
  [ "${out##*[[:space:]]}" = 0 ] || { echo "::error::$(full "$svc") 에 진행 중인 배포가 있습니다. 끝난 뒤 다시 실행하세요"; exit 1; }
done
running=$(q ecs list-tasks --cluster "$CLUSTER" --started-by "$STARTED_BY" --desired-status RUNNING --query 'length(taskArns)' --output text)
[ "$running" = 0 ] || { echo "::error::실행 중인 마이그레이션 task 가 있습니다 (started-by=$STARTED_BY). 끝난 뒤 다시 실행하세요"; exit 1; }

# ---------- 1. 새 revision 등록 ----------
for svc in "${SVC_NAMES[@]}"; do
  OLD_TD[$svc]=$(q ecs describe-services --cluster "$CLUSTER" --services "$(full "$svc")" \
    --query 'services[0].taskDefinition' --output text)
  q ecs describe-task-definition --task-definition "${OLD_TD[$svc]}" --include TAGS \
    --query '{td: taskDefinition, tags: tags}' --output json > "$WORK/$svc.json"
  python3 - "$WORK/$svc.json" "${IMAGE_OF[${KIND_OF[$svc]}]}" "$WORK/$svc-new.json" <<'PY'
import json, sys
src, image, dst = sys.argv[1:]
d = json.load(open(src))
td = d["td"]
apps = [c for c in td["containerDefinitions"] if c["name"] == "app"]
if len(apps) != 1:
    sys.exit("container 'app' 이 정확히 하나여야 합니다")
apps[0]["image"] = image
drop = {"taskDefinitionArn", "revision", "status", "requiresAttributes", "compatibilities",
        "registeredAt", "registeredBy", "deregisteredAt", "deleteRequestedAt"}
out = {k: v for k, v in td.items() if k not in drop}
if d.get("tags"):
    out["tags"] = d["tags"]
json.dump(out, open(dst, "w"))
PY
  NEW_TD[$svc]=$(aws ecs register-task-definition --cli-input-json "file://$WORK/$svc-new.json" \
    --query 'taskDefinition.taskDefinitionArn' --output text)
  echo "$(full "$svc"): ${OLD_TD[$svc]##*/} → ${NEW_TD[$svc]##*/}"
done

# ---------- one-off task ----------
# 반환: 0 성공 / 1 명령이 0 아닌 코드로 끝남 / 2 task 가 실행되지 못함·끝나지 않음
run_oneoff() {
  local desc="$1" cmd="$2" svc="$MIGRATE_SERVICE"
  echo "::group::$desc: $cmd"
  local cap overrides resp task
  cap=$(q ecs describe-services --cluster "$CLUSTER" --services "$(full "$svc")" \
    --query 'services[0].capacityProviderStrategy[0].capacityProvider' --output text)
  overrides=$(python3 -c 'import json,sys,shlex; print(json.dumps({"containerOverrides":[{"name":"app","command":shlex.split(sys.argv[1])}]}))' "$cmd")
  resp=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "${NEW_TD[$svc]}" \
    --capacity-provider-strategy "capacityProvider=$cap,weight=1" \
    --overrides "$overrides" --started-by "$STARTED_BY" --output json) || { echo "::endgroup::"; echo "run-task 호출 실패"; return 2; }
  task=$(echo "$resp" | python3 -c 'import json,sys; t=json.load(sys.stdin).get("tasks") or [{}]; print(t[0].get("taskArn",""))')
  if [ -z "$task" ]; then
    echo "$resp" | python3 -c 'import json,sys; print("run-task failures:", json.load(sys.stdin).get("failures"))'
    echo "::endgroup::"; return 2
  fi
  echo "task: ${task##*/}"
  local deadline=$((SECONDS + MIGRATE_TIMEOUT)) status last=""
  while :; do
    status=$(q ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" --query 'tasks[0].lastStatus' --output text)
    [ "$status" != "$last" ] && { echo "  $(date +%H:%M:%S) $status"; last="$status"; }
    [ "$status" = STOPPED ] && break
    if [ $SECONDS -ge $deadline ]; then
      if [ "$status" = RUNNING ]; then
        echo "::endgroup::"
        echo "::error::$desc 가 ${MIGRATE_TIMEOUT}초 안에 끝나지 않았습니다. task ${task##*/} 는 아직 실행 중입니다 — 끝날 때까지 다시 실행하지 마세요"
        return 2
      fi
      aws ecs stop-task --cluster "$CLUSTER" --task "$task" --reason "ecs-deploy: not started in time" >/dev/null || true
      echo "::endgroup::"; echo "::error::$desc task 가 ${MIGRATE_TIMEOUT}초 동안 시작되지 못해 중단했습니다 ($status) — 호스트 용량 확인"
      return 2
    fi
    sleep 10
  done
  local info code reason
  info=$(q ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" \
    --query 'tasks[0].[containers[?name==`app`].exitCode|[0], stoppedReason, containers[?name==`app`].reason|[0]]' --output text)
  code=$(echo "$info" | cut -f1); reason=$(echo "$info" | cut -f2-)
  aws logs get-log-events --log-group-name "/ecs/${APP}-${ENV_KEY}/${svc}" \
    --log-stream-name "${svc}/app/${task##*/}" --limit 80 \
    --query 'events[].message' --output text 2>/dev/null | tr '\t' '\n' || echo "(로그 없음)"
  echo "::endgroup::"
  echo "$desc 종료: exit=$code ($reason)"
  if [ "$code" = 0 ]; then return 0; fi
  if [ "$code" = None ] || [ -z "$code" ]; then return 2; fi
  return 1
}

# ---------- 2. 배포 전 마이그레이션 ----------
if [ "$MIGRATE_MODE" = check ]; then
  rc=0; run_oneoff "미적용 마이그레이션 확인" "$CHECK_COMMAND" || rc=$?
  case $rc in
    0) ;;
    1) fail "미적용 마이그레이션이 있습니다. 하위 호환이면 'Migrate Before Deploy', DROP 류면 'Migrate After Deploy' 로 다시 배포하세요" ;;
    *) fail "확인용 task 가 실행되지 못했습니다(위 사유: 이미지·시크릿·호스트 용량). 마이그레이션 문제가 아닙니다" ;;
  esac
elif [ "$MIGRATE_MODE" = before ]; then
  rc=0; run_oneoff "배포 전 마이그레이션" "$MIGRATE_COMMAND" || rc=$?
  [ $rc = 0 ] || fail "배포 전 migrate 실패 — 서비스는 바꾸지 않았습니다"
fi

# ---------- 3. 서비스 롤링 (하나씩) ----------
for svc in "${SVC_NAMES[@]}"; do
  name=$(full "$svc"); echo "::group::배포: $name"
  start_epoch=$(date +%s)
  dep=$(aws ecs update-service --cluster "$CLUSTER" --service "$name" --task-definition "${NEW_TD[$svc]}" \
    --query 'service.deployments[?status==`PRIMARY`].id|[0]' --output text)
  deadline=$((SECONDS + STABLE_TIMEOUT))
  while :; do
    state=$(q ecs describe-services --cluster "$CLUSTER" --services "$name" \
      --query "services[0].deployments[?id=='$dep'].rolloutState|[0]" --output text)
    case "$state" in
      COMPLETED) break ;;
      FAILED) echo "::endgroup::"; fail "$name 배포 실패 — circuit breaker 가 이전 revision 으로 롤백" ;;
      None) # 롤백되면 이 deployment 는 목록에서 사라진다
        primary=$(q ecs describe-services --cluster "$CLUSTER" --services "$name" \
          --query 'services[0].deployments[?status==`PRIMARY`].[taskDefinition,rolloutState]|[0]' --output text)
        if [ "${primary%%[[:space:]]*}" = "${NEW_TD[$svc]}" ] && [ "${primary##*[[:space:]]}" = COMPLETED ]; then break; fi
        cur_td="${primary%%[[:space:]]*}"
        [ "$cur_td" = "${NEW_TD[$svc]}" ] || { echo "::endgroup::"; fail "$name 롤백됨 (지금 ${cur_td##*/})"; } ;;
    esac
    [ $SECONDS -lt $deadline ] || { echo "::endgroup::"; fail "$name 안정화 ${STABLE_TIMEOUT}초 초과 — ECS 배포는 계속 진행 중일 수 있습니다"; }
    sleep 10
  done
  # 완료 뒤에도 새 task 가 버티는지 (worker·beat 는 헬스체크가 없어 바로 죽어도 COMPLETED 가 된다)
  desired=$(q ecs describe-services --cluster "$CLUSTER" --services "$name" --query 'services[0].desiredCount' --output text)
  if [ "$desired" != 0 ] && [ "$SETTLE_SECONDS" -gt 0 ]; then
    echo "완료. ${SETTLE_SECONDS}초 동안 새 task 가 죽지 않는지 확인"
    sleep "$SETTLE_SECONDS"
    out=$(q ecs describe-services --cluster "$CLUSTER" --services "$name" \
      --query 'services[0].[runningCount,desiredCount,taskDefinition]' --output text)
    read -r run des cur <<< "$out"
    stopped=$(q ecs list-tasks --cluster "$CLUSTER" --service-name "$name" --desired-status STOPPED --query 'taskArns' --output text)
    crashed=0
    if [ -n "$stopped" ] && [ "$stopped" != None ]; then
      crashed=$(q ecs describe-tasks --cluster "$CLUSTER" --tasks $stopped --output json | python3 -c '
import json, sys
new, since = sys.argv[1], float(sys.argv[2])
print(sum(1 for t in json.load(sys.stdin)["tasks"]
          if t["taskDefinitionArn"] == new and t.get("stoppedAt", 0) >= since))' "${NEW_TD[$svc]}" "$start_epoch")
    fi
    if [ "$run" != "$des" ] || [ "$cur" != "${NEW_TD[$svc]}" ] || [ "$crashed" != 0 ]; then
      echo "::endgroup::"; fail "$name: 새 task 가 안정적이지 않습니다 (running $run/$des, 새 버전으로 멈춘 task $crashed)"
    fi
  fi
  echo "$name 완료"; echo "::endgroup::"
done

# ---------- 4. 이미지 태그 기록 (전부 성공한 뒤에만) ----------
for kind in "${!IMAGE_OF[@]}"; do
  uri="${IMAGE_OF[$kind]}"
  aws ssm put-parameter --name "/deploy/${ENV_KEY}/${APP}/${kind}-image-tag" \
    --type String --overwrite --value "${uri##*:}" >/dev/null
  echo "SSM /deploy/${ENV_KEY}/${APP}/${kind}-image-tag = ${uri##*:}"
done

# ---------- 5. 배포 후 마이그레이션 ----------
if [ "$MIGRATE_MODE" = after ]; then
  rc=0; run_oneoff "배포 후 마이그레이션" "$MIGRATE_COMMAND" || rc=$?
  [ $rc = 0 ] || { echo "::error::배포 후 migrate 실패 — 서비스는 새 버전, 스키마는 이전 상태입니다. 즉시 확인 필요"; exit 1; }
fi
rm -rf "$WORK"
echo "배포 완료: ${APP} ${ENV_KEY}"
