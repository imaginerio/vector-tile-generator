# No local roads buildings, or parcels
tippecanoe -Z 8 -z 11 -pf -pk -ab -ai -f -o allzooms.mbtiles \
  -j '{ "RoadsLine": ["in", "type", "Interstate", "Highway", "Primary", "Secondary"] }' \
  -y type \
  -y name \
  -y firstyear \
  -y lastyear \
  -y namealt \
  geojson/final/BoundariesPoly.json \
  geojson/final/GroundCoverPoly.json \
  geojson/final/HidrographyLine.json \
  geojson/final/HidrographyPoly.json \
  geojson/final/OpenSpacesPoly.json \
  geojson/final/RoadsLine.json \
  geojson/final/UtilitiesLine.json \
  geojson/final/WaterWorksPoly.json

# Adding in buildings
tippecanoe -Z 12 -z 12 -pf -pk -ab -ai -f -o LocalRoads.mbtiles \
  -y type \
  -y name \
  -y firstyear \
  -y lastyear \
  -y namealt \
  geojson/final/BoundariesPoly.json \
  geojson/final/GroundCoverPoly.json \
  geojson/final/HidrographyLine.json \
  geojson/final/HidrographyPoly.json \
  geojson/final/OpenSpacesPoly.json \
  geojson/final/RoadsLine.json \
  geojson/final/UtilitiesLine.json \
  geojson/final/WaterWorksPoly.json

# Removing filter to add local roads
tippecanoe -Z 13 -z 16 -pf -pk -ab -ai -f -o BuildingsPoly.mbtiles \
  -y type \
  -y name \
  -y firstyear \
  -y lastyear \
  -y namealt \
  geojson/final/BoundariesPoly.json \
  geojson/final/BuildingsPoly.json \
  geojson/final/GroundCoverPoly.json \
  geojson/final/HidrographyLine.json \
  geojson/final/HidrographyPoly.json \
  geojson/final/OpenSpacesPoly.json \
  geojson/final/RoadsLine.json \
  geojson/final/UtilitiesLine.json \
  geojson/final/WaterWorksPoly.json

mapshaper geojson/final/ViewConesPoly.json -points x=longitude y=latitude -o geojson/final/ViewConesPoint.json
tippecanoe -Z 9 -z 16 -pf -pk -pf -f -o ViewCones.mbtiles geojson/final/ViewConesPoint.json

tile-join -pk -f -o tiles.mbtiles allzooms.mbtiles BuildingsPoly.mbtiles LocalRoads.mbtiles ViewCones.mbtiles