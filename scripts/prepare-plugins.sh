#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MAVEN_DIR="${ROOT_DIR}/wb-data-server"
PLUGINS_DIR="${ROOT_DIR}/plugins"
PLUGIN_MODULES=(
  "wb-data-plugins/wb-data-plugin-mysql"
  "wb-data-plugins/wb-data-plugin-hive"
  "wb-data-plugins/wb-data-plugin-postgresql"
  "wb-data-plugins/wb-data-plugin-clickhouse"
)

mkdir -p "${PLUGINS_DIR}"

need_build=0
if [[ "${1:-}" == "--rebuild" ]]; then
  need_build=1
else
  for mod in "${PLUGIN_MODULES[@]}"; do
    if ! compgen -G "${MAVEN_DIR}/${mod}/target/*-plugin.jar" > /dev/null; then
      need_build=1
      break
    fi
  done
fi

if [[ "${need_build}" -eq 1 ]]; then
  cd "${MAVEN_DIR}"
  IFS=,
  mvn -q -pl "${PLUGIN_MODULES[*]}" -am -DskipTests package
  unset IFS
fi

for mod in "${PLUGIN_MODULES[@]}"; do
  cp -f "${MAVEN_DIR}/${mod}"/target/*-plugin.jar "${PLUGINS_DIR}/"
done

echo "Prepared plugin jars in ${PLUGINS_DIR}"
