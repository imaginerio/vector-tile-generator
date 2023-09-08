for f in geojson/RoadsLine*.geojson
  do
    mapshaper -i $f -each "namealt = namealt ? namealt.replace(/\\D/gm, '') : null; namealt = namealt === '' ? null : namealt" -o $f force
  done

for f in geojson/*.geojson
  do
    mapshaper -i $f -filter remove-empty -o $f force
  done

tippecanoe -Z 8 -z 11 -pf -pk -ab -ai -f -o RoadsLine-low.mbtiles \
  -l RoadsLine \
  -j '{ "RoadsLine": ["in", "type", "Interstate", "Highway", "Primary", "Secondary"] }' \
  -y type \
  -y name \
  -y firstyear \
  -y lastyear \
  -y namealt \
  geojson/RoadsLine*.geojson

tippecanoe -Z 12 -z 16 -pf -pk -ab -ai -f -o RoadsLine-high.mbtiles \
  -l RoadsLine \
  -y type \
  -y name \
  -y firstyear \
  -y lastyear \
  -y namealt \
  geojson/RoadsLine*.geojson

tippecanoe -Z 8 -z 16 -pf -pk -ab -ai -f -o BoundariesPoly.mbtiles \
  -l BoundariesPoly \
  -y type \
  -y name \
  -y firstyear \
  -y lastyear \
  -y namealt \
  geojson/BoundariesPoly*.geojson

tippecanoe -Z 8 -z 16 -pf -pk -ab -ai -f -o GroundCoverPoly.mbtiles \
  -l GroundCoverPoly \
  -y type \
  -y name \
  -y firstyear \
  -y lastyear \
  -y namealt \
  geojson/GroundCoverPoly*.geojson

tippecanoe -Z 8 -z 16 -pf -pk -ab -ai -f -o HidrographyLine.mbtiles \
  -l HidrographyLine \
  -y type \
  -y name \
  -y firstyear \
  -y lastyear \
  -y namealt \
  geojson/HidrographyLine*.geojson

tippecanoe -Z 8 -z 16 -pf -pk -ab -ai -f -o HidrographyPoly.mbtiles \
  -l HidrographyPoly \
  -y type \
  -y name \
  -y firstyear \
  -y lastyear \
  -y namealt \
  geojson/HidrographyPoly*.geojson

tippecanoe -Z 8 -z 16 -pf -pk -ab -ai -f -o OpenSpacesPoly.mbtiles \
  -l OpenSpacesPoly \
  -y type \
  -y name \
  -y firstyear \
  -y lastyear \
  -y namealt \
  geojson/OpenSpacesPoly*.geojson

tippecanoe -Z 8 -z 16 -pf -pk -ab -ai -f -o UtilitiesLine.mbtiles \
  -l UtilitiesLine \
  -y type \
  -y name \
  -y firstyear \
  -y lastyear \
  -y namealt \
  geojson/UtilitiesLine*.geojson

tippecanoe -Z 8 -z 16 -pf -pk -ab -ai -f -o WaterWorksPoly.mbtiles \
  -l WaterWorksPoly \
  -y type \
  -y name \
  -y firstyear \
  -y lastyear \
  -y namealt \
  geojson/WaterWorksPoly*.geojson

# Removing filter to add local roads
tippecanoe -Z 13 -z 16 -pf -pk -ab -ai -f -o BuildingsPoly.mbtiles \
  -l BuildingsPoly \
  -y type \
  -y name \
  -y firstyear \
  -y lastyear \
  -y namealt \
  geojson/BuildingsPoly*.geojson \

mapshaper geojson/ViewConesPoly*.geojson -points x=longitude y=latitude -o geojson/ViewConesPoint.geojson
tippecanoe -Z 9 -z 16 -pf -pk -pf -f -o ViewCones.mbtiles geojson/ViewConesPoint.geojson

tile-join -pk -f -o tiles.mbtiles *.mbtiles

mb-util --image_format=pbf tiles.mbtiles tiles

aws s3 sync tiles s3://${AWS_BUCKET}/base --acl public-read --cache-control max-age=31536000 --delete