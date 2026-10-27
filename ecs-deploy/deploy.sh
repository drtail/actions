#!/usr/bin/env bash
# ECS 배포 (DRT-7208). 트리거·라벨은 각 레포 워크플로가 그대로 정하고, 실행만 여기서 한다.
#
# 1. 이미지 태그를 SSM /deploy/<env>/<app>/<kind>-image-tag 에 기록
#    (CDK 서비스 스택이 이 값을 읽으므로 나중에 cdk deploy 를 해도 옛 이미지로 안 돌아감)
# 2. 서비스마다 지금 task definition 을 새 이미지로 바꾼 revision 을 등록
# 3. 마이그레이션 (migrate_mode)
#    - check : 새 이미지로 one-off task `migrate --check` → 미적용이 있으면 배포 중단
#    - before: 배포 전에 `migrate`
#    - after : 배포 후에 `migrate` (DROP 류)
#    - none  : 안 함
# 4. 서비스를 순서대로 하나씩 update-service → 안정화 대기. circuit breaker 가 롤백하면 실패
#
# DB 비밀번호는 러너로 가져오지 않는다 — one-off task 가 task definition 의 secrets/SSM 으로 받는다.
set -euo pipefail

: "${REGION:?}" "${CLUSTER:?}" "${APP:?}" "${ENV_KEY:?}" "${SERVICES:?}" "${IMAGES:?}"
MIGRATE_MODE="${MIGRATE_MODE:-check}"
MIGRATE_SERVICE="${MIGRATE_SERVICE:-api}"
MIGRATE_COMMAND="${MIGRATE_COMMAND:-python manage.py migrate --noinput}"
CHECK_COMMAND="${CHECK_COMMAND:-python manage.py migrate --check}"
STABLE_TIMEOUT="${STABLE_TIMEOUT:-1200}"

aws() { command aws --region "$REGION" "$@"; }
log() { echo "::group::$*"; }
endlog() { echo "::endgroup::"; }

# IMAGES: "kind=uri,kind=uri"  SERVICES: "service:kind,service:kind" (배포 순서)
declare -A IMAGE_OF
IFS=',' read -ra pairs <<< "$IMAGES"
for p in "${pairs[@]}"; do IMAGE_OF["${p%%=*}"]="${p#*=}"; done

# 1. SSM 이미지 태그
for kind in "${!IMAGE_OF[@]}"; do
  uri="${IMAGE_OF[$kind]}"
  aws ssm put-parameter --name "/deploy/${ENV_KEY}/${APP}/${kind}-image-tag" \
    --type String --overwrite --value "${uri##*:}" >/dev/null
  echo "SSM /deploy/${ENV_KEY}/${APP}/${kind}-image-tag = ${uri##*:}"
done

# 2. 새 revision 등록
declare -A NEW_TD
IFS=',' read -ra svcs <<< "$SERVICES"
for entry in "${svcs[@]}"; do
  svc="${entry%%:*}"; kind="${entry#*:}"
  name="${APP}-${ENV_KEY}-${svc}"
  current=$(aws ecs describe-services --cluster "$CLUSTER" --services "$name" \
    --query 'services[0].taskDefinition' --output text)
  aws ecs describe-task-definition --task-definition "$current" --include TAGS \
    --query '{td: taskDefinition, tags: tags}' --output json > /tmp/td-$svc.json
  python3 - "$svc" "${IMAGE_OF[$kind]}" <<'PY'
import json, sys
svc, image = sys.argv[1], sys.argv[2]
d = json.load(open(f"/tmp/td-{svc}.json"))
td = d["td"]
for c in td["containerDefinitions"]:
    if c["name"] == "app":
        c["image"] = image
drop = {"taskDefinitionArn", "revision", "status", "requiresAttributes", "compatibilities",
        "registeredAt", "registeredBy", "deregisteredAt"}
out = {k: v for k, v in td.items() if k not in drop}
if d.get("tags"):
    out["tags"] = d["tags"]
json.dump(out, open(f"/tmp/td-{svc}-new.json", "w"))
PY
  NEW_TD[$svc]=$(aws ecs register-task-definition --cli-input-json "file:///tmp/td-$svc-new.json" \
    --query 'taskDefinition.taskDefinitionArn' --output text)
  echo "$name → ${NEW_TD[$svc]##*/}"
done

run_oneoff() {  # $1 = 설명, $2 = 명령
  local svc="$MIGRATE_SERVICE" desc="$1" cmd="$2"
  log "$desc: $cmd"
  local cap; cap=$(aws ecs describe-services --cluster "$CLUSTER" --services "${APP}-${ENV_KEY}-${svc}" \
    --query 'services[0].capacityProviderStrategy[0].capacityProvider' --output text)
  local overrides; overrides=$(python3 -c 'import json,sys,shlex; print(json.dumps({"containerOverrides":[{"name":"app","command":shlex.split(sys.argv[1])}]}))' "$cmd")
  local task; task=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "${NEW_TD[$svc]}" \
    --capacity-provider-strategy "capacityProvider=$cap,weight=1" \
    --overrides "$overrides" --started-by "ecs-deploy/${GITHUB_RUN_ID:-local}" \
    --query 'tasks[0].taskArn' --output text)
  [ "$task" != "None" ] || { echo "run-task 실패"; endlog; return 1; }
  aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task" || \
    aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task"
  local code reason
  code=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" --query 'tasks[0].containers[0].exitCode' --output text)
  reason=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" --query 'tasks[0].stoppedReason' --output text)
  local stream="${svc}/app/${task##*/}"
  aws logs get-log-events --log-group-name "/ecs/${APP}-${ENV_KEY}/${svc}" --log-stream-name "$stream" \
    --start-from-head --limit 200 --query 'events[].message' --output text 2>/dev/null | tr '\t' '\n' | tail -50 || true
  endlog
  echo "$desc 종료: exit=$code ($reason)"
  [ "$code" = "0" ]
}

# 3. 배포 전 마이그레이션
case "$MIGRATE_MODE" in
  check)  run_oneoff "미적용 마이그레이션 확인" "$CHECK_COMMAND" || {
            echo "::error::미적용 마이그레이션이 있습니다. 하위 호환이면 'Migrate Before Deploy', DROP 류면 'Migrate After Deploy' 로 다시 배포하세요."; exit 1; } ;;
  before) run_oneoff "배포 전 마이그레이션" "$MIGRATE_COMMAND" || { echo "::error::migrate 실패 — 배포하지 않습니다"; exit 1; } ;;
  after|none) ;;
  *) echo "::error::알 수 없는 MIGRATE_MODE=$MIGRATE_MODE"; exit 1 ;;
esac

# 4. 서비스 롤링 (하나씩 — 호스트 메모리 피크 방지)
for entry in "${svcs[@]}"; do
  svc="${entry%%:*}"; name="${APP}-${ENV_KEY}-${svc}"
  log "배포: $name"
  dep=$(aws ecs update-service --cluster "$CLUSTER" --service "$name" \
    --task-definition "${NEW_TD[$svc]}" --query 'service.deployments[?status==`PRIMARY`].id|[0]' --output text)
  deadline=$((SECONDS + STABLE_TIMEOUT))
  while :; do
    state=$(aws ecs describe-services --cluster "$CLUSTER" --services "$name" \
      --query "services[0].deployments[?id=='$dep'].rolloutState|[0]" --output text)
    case "$state" in
      COMPLETED) echo "$name 완료"; break ;;
      FAILED) endlog; echo "::error::$name 배포 실패 — circuit breaker 가 이전 revision 으로 롤백했습니다"; exit 1 ;;
      None) # 롤백되면 이 deployment 는 목록에서 사라진다
        primary=$(aws ecs describe-services --cluster "$CLUSTER" --services "$name" \
          --query 'services[0].deployments[?status==`PRIMARY`].taskDefinition|[0]' --output text)
        [ "$primary" = "${NEW_TD[$svc]}" ] && { echo "$name 완료"; break; }
        endlog; echo "::error::$name 롤백됨 (primary=$primary)"; exit 1 ;;
    esac
    [ $SECONDS -lt $deadline ] || { endlog; echo "::error::$name 안정화 시간 초과"; exit 1; }
    sleep 10
  done
  endlog
done

# 5. 배포 후 마이그레이션
if [ "$MIGRATE_MODE" = "after" ]; then
  run_oneoff "배포 후 마이그레이션" "$MIGRATE_COMMAND" || { echo "::error::배포 후 migrate 실패 — 서비스는 새 버전, 스키마는 옛 버전입니다"; exit 1; }
fi
echo "배포 완료: ${APP} ${ENV_KEY}"
