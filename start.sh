#!/usr/bin/env bash

docker run -p 5333:5333/udp \
  -v $(pwd)/skeeterdns.toml:/config.toml \
  skeeterdns
