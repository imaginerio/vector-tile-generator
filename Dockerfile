FROM ubuntu:16.04

EXPOSE 5000

ARG NODE_ENV
ENV NODE_ENV $NODE_ENV

RUN apt-get update && apt-get -y install build-essential libsqlite3-dev zlib1g-dev curl git python-setuptools python-dev awscli

RUN curl -sL https://deb.nodesource.com/setup_12.x | bash
RUN apt-get install -y nodejs

RUN git clone https://github.com/mapbox/tippecanoe.git \
  && cd tippecanoe \
  && make \
  && make install

RUN npm install -g mapshaper
COPY package.json package.json

RUN git clone https://github.com/mapbox/mbutil.git \
  && cd mbutil \
  && python setup.py install

COPY package.json package.json
RUN npm install

COPY . .
RUN mkdir -p geojson/final

ENTRYPOINT [ "node", "index" ]
