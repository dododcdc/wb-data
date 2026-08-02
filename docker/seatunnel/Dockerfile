ARG SEATUNNEL_BASE_IMAGE=apache/seatunnel:2.3.13
FROM ${SEATUNNEL_BASE_IMAGE}

ENV JAVA_HOME=/usr/local/openjdk-8
ENV PATH="${JAVA_HOME}/bin:${PATH}"

ARG HIVE_JDBC_VERSION=3.1.3
ARG HIVE_JDBC_SHA1=a5b6b2f2afbb2b9d5b2bca9396d6e16da8c18edb

ADD https://repo1.maven.org/maven2/org/apache/hive/hive-jdbc/${HIVE_JDBC_VERSION}/hive-jdbc-${HIVE_JDBC_VERSION}.jar /opt/seatunnel/lib/hive-jdbc-${HIVE_JDBC_VERSION}.jar

RUN set -eu; \
    echo "${HIVE_JDBC_SHA1}  /opt/seatunnel/lib/hive-jdbc-${HIVE_JDBC_VERSION}.jar" | sha1sum -c -; \
    chmod 0644 "/opt/seatunnel/lib/hive-jdbc-${HIVE_JDBC_VERSION}.jar"; \
    ln -sf "${JAVA_HOME}/bin/java" /usr/local/bin/java; \
    ln -sf "${JAVA_HOME}/bin/jar" /usr/local/bin/jar; \
    groupadd --gid 1000 hive; \
    useradd --uid 1000 --gid 1000 --home-dir /tmp --no-create-home --shell /usr/sbin/nologin hive; \
    jar tf "/opt/seatunnel/lib/hive-jdbc-${HIVE_JDBC_VERSION}.jar" | grep -q 'org/apache/hive/jdbc/HiveDriver.class'

USER hive
