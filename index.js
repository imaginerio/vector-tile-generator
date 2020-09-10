const fs = require('fs').promises;
const { exec } = require('child_process');
const axios = require('axios');
const ora = require('ora');
const { range, omit } = require('lodash');
const mapshaper = require('mapshaper');
const tippecanoe = require('tippecanoe');
const tilelive = require('@mapbox/tilelive');
const MBTiles = require('@mapbox/mbtiles');
const s3 = require('@mapbox/tilelive-s3');

const STEP = 200;

const spinner = ora('Loading layer info').start();

const loadFeatures = async (i, count, step, layer) =>
  axios
    .get(
      `https://arcgis.rice.edu/arcgis/rest/services/imagineRio_Data/FeatureServer/${layer.id}/query?where=objectid IS NOT NULL&outFields=objectid,nameshort,nameabbrev,name,firstyear,lastyear,type&f=geojson&resultRecordCount=${step}&resultOffset=${i}`
    )
    .then(({ data }) => {
      spinner.text = `${layer.name}: Loading features ${i} / ${count}`;
      return fs.writeFile(
        `geojson/${layer.name}-${i}.geojson`,
        JSON.stringify(omit(data, 'exceededTransferLimit'))
      );
    });

const loadLayer = async layer => {
  spinner.start(`${layer.name}: Loading features`);
  const {
    data: { count },
  } = await axios.get(
    `https://arcgis.rice.edu/arcgis/rest/services/imagineRio_Data/FeatureServer/${layer.id}/query?where=objectid IS NOT NULL&f=json&returnCountOnly=true`
  );

  const step = layer.name === 'GroundCoverPoly' ? 5 : STEP;
  return range(0, Math.min(count || 1, step), step).reduce(async (previousPromise, next) => {
    await previousPromise;
    return loadFeatures(next, count, step, layer);
  }, Promise.resolve());
};

exec('rm geojson/*.geojson && rm geojson/final/*.geojson');
axios
  .get('https://arcgis.rice.edu/arcgis/rest/services/imagineRio_Data/FeatureServer/layers?f=json')
  .then(({ data: { layers } }) => {
    spinner.succeed(`${layers.length} layers loaded`);
    return layers
      .filter(l => !l.name.match(/^ir_rio/))
      .reduce(async (previousPromise, layer) => {
        await previousPromise;
        return loadLayer(layer)
          .then(() =>
            mapshaper.runCommands(
              `-i geojson/${layer.name}*.geojson combine-files -merge-layers -o geojson/final/${layer.name}.geojson force format=geojson`
            )
          )
          .then(() => spinner.succeed(`${layer.name} loaded`));
      }, Promise.resolve());
  });
