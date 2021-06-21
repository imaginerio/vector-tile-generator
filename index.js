#!/usr/bin/env node
/* eslint-disable camelcase */
require('dotenv').config();
const { argv } = require('yargs');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { promisify } = require('util');
const axios = require('axios');
const ora = require('ora');
const { range, omit } = require('lodash');
const mapshaper = require('mapshaper');
const tippecanoe = require('tippecanoe');
const tilelive = require('@mapbox/tilelive');
const MBTiles = require('@mapbox/mbtiles');
const s3 = require('@mapbox/tilelive-s3');

const loadAsync = promisify(tilelive.load);
const copyAsync = promisify(tilelive.copy);

const STEP = 200;
let VECTOR_LAYERS = [];
const OMIT = [
  'ViewConesPoly',
  'SurveyExtentsPoly',
  'AerialExtentsPoly',
  'PlanExtentsPoly',
  'MapExtentsPoly',
];
const spinner = ora('Generating vector tiles\n').start();

let access_token;

const loadFeatures = async (i, count, step, layer) =>
  axios
    .get(
      `https://enterprise.spatialstudieslab.org/server/rest/services/Hosted/imagineRio/FeatureServer/${layer.id}/query?where=shape IS NOT NULL&outFields=objectid,nameshort,name,firstyear,lastyear,type&f=geojson&resultRecordCount=${step}&resultOffset=${i}&token=${access_token}`,
      { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
    )
    .then(({ data }) => {
      spinner.text = `${layer.name}: Loading features ${i} / ${count}`;
      return fs.promises.writeFile(
        path.join(__dirname, 'geojson/', `${layer.name}-${i}.geojson`),
        JSON.stringify(omit(data, 'exceededTransferLimit'))
      );
    });

const loadLayer = async layer => {
  spinner.start(`${layer.name}: Loading features`);
  const {
    data: { count },
  } = await axios.get(
    `https://enterprise.spatialstudieslab.org/server/rest/services/Hosted/imagineRio/FeatureServer/${layer.id}/query?where=objectid IS NOT NULL&f=json&returnCountOnly=true&token=${access_token}`,
    { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
  );

  const step = layer.name === 'GroundCoverPoly' ? 5 : STEP;
  return range(0, count || 1, step).reduce(async (previousPromise, next) => {
    await previousPromise;
    const exists = fs.existsSync(path.join(__dirname, 'geojson/', `${layer.name}-${next}.geojson`));
    if (exists) return Promise.resolve();
    return loadFeatures(next, count, step, layer);
  }, Promise.resolve());
};

const upload = async () => {
  tippecanoe(VECTOR_LAYERS, {
    f: true,
    Z: 9,
    z: 17,
    r1: true,
    o: 'rio.mbtiles',
  });

  spinner.start('Uploading vector tiles to S3');
  s3.registerProtocols(tilelive);
  MBTiles.registerProtocols(tilelive);

  const sourceUri = `mbtiles://${path.join(__dirname, 'rio.mbtiles')}`;
  const sinkUri = process.env.AWS_BUCKET;

  const src = await loadAsync(sourceUri);
  const dest = await loadAsync(sinkUri);
  const options = {
    type: 'list',
    listScheme: src.createZXYStream(),
  };
  return copyAsync(src, dest, options).then(() => spinner.succeed());
};

const main = () => {
  spinner.text = 'Loading layer info';
  axios
    .get(
      `https://enterprise.spatialstudieslab.org/server/rest/services/Hosted/imagineRio/FeatureServer/layers?f=json&token=${access_token}`,
      { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
    )
    .then(({ data: { layers } }) => {
      spinner.succeed(`${layers.length} layers loaded`);
      return layers
        .filter(l => !OMIT.includes(l.name))
        .reduce(async (previousPromise, layer) => {
          await previousPromise;
          return loadLayer(layer)
            .then(() =>
              mapshaper.runCommands(
                `-i geojson/${layer.name}*.geojson combine-files -merge-layers
                -o geojson/final/${layer.name.toLowerCase()}.geojson force format=geojson id-field=objectid`
              )
            )
            .then(() => {
              VECTOR_LAYERS.push(`geojson/final/${layer.name.toLowerCase()}.geojson`);
              return spinner.succeed(`${layer.name} loaded`);
            });
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
  const files = fs.readdirSync('geojson/final');
  VECTOR_LAYERS = files.map(f => `geojson/final/${f}`);
  upload();
} else {
  authenticate().then(() => main());
}
