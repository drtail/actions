#! /bin/bash

current_tag=$(echo $GITHUB_REF | sed 's/refs\/tags\///')
echo "Current tag is $current_tag"
if [[ ! $current_tag == v* ]]; then
  echo "Tag name should start with v but was $current_tag"
  exit 1
fi
major_tag=$(echo $current_tag | cut -d. -f1)
echo "Major tag is $major_tag"

sed -i -E 's|^/?dist/?||g' .gitignore
rm -fr .github/workflows

git add .
if [[ -z $(git status --porcelain) ]]; then
  echo "Current tag is up-to-date"
  exit 0
fi

git config user.name "github-actions"
git config user.email "github-actions@github.com"
git commit -m "Release $current_tag"
git tag -f $current_tag
git tag -f $major_tag
git push origin -f $current_tag $major_tag
