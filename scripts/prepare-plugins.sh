#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLUGINS_DIR="${ROOT_DIR}/plugins"

mkdir -p "${PLUGINS_DIR}"

cd "${ROOT_DIR}"

mvn -q \
  -pl wb-data-plugin-mysql,wb-data-plugin-hive,wb-data-plugin-postgresql,wb-data-plugin-starrocks \
  -am \
  -DskipTests \
  install

cp -f "${ROOT_DIR}"/wb-data-plugin-mysql/target/*-plugin.jar "${PLUGINS_DIR}/"
cp -f "${ROOT_DIR}"/wb-data-plugin-hive/target/*-plugin.jar "${PLUGINS_DIR}/"
cp -f "${ROOT_DIR}"/wb-data-plugin-postgresql/target/*-plugin.jar "${PLUGINS_DIR}/"
cp -f "${ROOT_DIR}"/wb-data-plugin-starrocks/target/*-plugin.jar "${PLUGINS_DIR}/"

echo "Prepared plugin jars in ${PLUGINS_DIR}"
