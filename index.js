#!/usr/bin/env node
/* eslint-disable camelcase */
/* eslint-disable no-console */
require('dotenv').config();
const { argv } = require('yargs');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { promisify } = require('util');
const shell = require('shelljs');
const axios = require('axios');
const { range, omit } = require('lodash');
const tilelive = require('@mapbox/tilelive');
const MBTiles = require('@mapbox/mbtiles');
const s3 = require('@mapbox/tilelive-s3');

const loadAsync = promisify(tilelive.load);
const copyAsync = promisify(tilelive.copy);

const STEP = process.env.STEP || 1000;
const OMIT = JSON.parse(process.env.OMIT);

let access_token;

const loadFeatures = async (i, count, step, layer) => {
  return axios
    .get(
      `https://enterprise.spatialstudieslab.org/server/rest/services/Hosted/HighwaysWaterways_Data/FeatureServer/${layer.id}/query?where=shape IS NOT NULL&outFields=*&f=geojson&resultRecordCount=${step}&resultOffset=${i}&token=${access_token}`,
      { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
    )
    .then(async ({ data }) => {
      console.log(`${layer.name}: Loading features ${i} / ${count}`);
      const geojson = omit(data, 'exceededTransferLimit');
      if (geojson.features) {
        return fs.promises.writeFile(
          path.join(__dirname, 'geojson/', `${layer.name}-${i}.geojson`),
          JSON.stringify(geojson)
        );
      }
      console.log('An error occurred. Retrying');
      // eslint-disable-next-line no-use-before-define
      authenticate().then(() => main());
      return Promise.reject();
    })
    .catch(err => console.log(err));
};

const loadLayer = async layer => {
  console.log(`${layer.name}: Loading features`);
  const {
    data: { count },
  } = await axios.get(
    `https://enterprise.spatialstudieslab.org/server/rest/services/Hosted/HighwaysWaterways_Data/FeatureServer/${layer.id}/query?where=objectid IS NOT NULL&f=json&returnCountOnly=true&token=${access_token}`,
    { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
  );

  const step = STEP;
  return range(0, count || 1, step).reduce(async (previousPromise, next) => {
    await previousPromise;
    const exists = fs.existsSync(path.join(__dirname, 'geojson/', `${layer.name}-${next}.geojson`));
    if (exists) return Promise.resolve();
    return loadFeatures(next, count, step, layer);
  }, Promise.resolve());
};

const upload = async () => {
  console.log('Creating MBTiles');
  shell.exec('./tiles.sh');
  console.log();

  console.log('Uploading vector tiles to S3');
  s3.registerProtocols(tilelive);
  MBTiles.registerProtocols(tilelive);

  const sourceUri = `mbtiles://${path.join(__dirname, 'tiles.mbtiles')}`;
  const sinkUri = process.env.AWS_BUCKET;

  const src = await loadAsync(sourceUri);
  const dest = await loadAsync(sinkUri);
  const options = {
    type: 'list',
    listScheme: src.createZXYStream(),
  };
  await copyAsync(src, dest, options);
  console.log('Upload complete');
};

const main = async () => {
  console.log('Loading layer info');
  axios
    .get(
      `https://enterprise.spatialstudieslab.org/server/rest/services/Hosted/HighwaysWaterways_Data/FeatureServer/layers?f=json&token=${access_token}`,
      { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
    )
    .then(({ data: { layers } }) => {
      console.log(`${layers.length} layers loaded`);
      return layers
        .filter(l => !OMIT.includes(l.name))
        .reduce(async (previousPromise, layer) => {
          await previousPromise;
          return loadLayer(layer)
            .then(() => {
              return console.log(`${layer.name} loaded`);
            })
            .catch(err => console.log(err));
        }, Promise.resolve());
    })
    .then(upload);
};

const authenticate = () => {
  const { CLIENT_ID, USERNAME, PASSWORD } = process.env;
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });
  return axios
    .get(
      `https://enterprise.spatialstudieslab.org/portal/sharing/rest/oauth2/authorize/?client_id=${CLIENT_ID}&response_type=code&expiration=3600&redirect_uri=urn:ietf:wg:oauth:2.0:oob`,
      { httpsAgent }
    )
    .then(({ data }) => {
      const oauth = data.replace(/^.*"oauth_state":"(.*?)".*$/gs, '$1');
      return axios
        .post(
          `https://enterprise.spatialstudieslab.org/portal/sharing/oauth2/signin?oauth_state=${oauth}&authorize=true&username=${USERNAME}&password=${PASSWORD}`,
          {},
          { httpsAgent }
        )
        .then(res => {
          const code = res.data.replace(/^.*id="code" value="(.*?)".*$/gs, '$1');
          return axios
            .post(
              `https://enterprise.spatialstudieslab.org/portal/sharing/oauth2/token?client_id=${CLIENT_ID}&code=${code}&redirect_uri=urn:ietf:wg:oauth:2.0:oob&grant_type=authorization_code`,
              {},
              { httpsAgent }
            )
            .then(res2 => {
              ({ access_token } = res2.data);
              return Promise.resolve();
            });
        });
    });
};

if (argv.upload) {
  upload();
} else {
  authenticate().then(() => main());
}
