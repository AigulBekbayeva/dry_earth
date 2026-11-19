#!/usr/bin/env bash
# Downloads every raw input into ./raw (about 150 MB). Run from the repository root:
#   bash scripts/download.sh && bash scripts/build.sh
set -euo pipefail
RAW="${1:-raw}"
mkdir -p "$RAW/atlas/pr" "$RAW/atlas/tas" "$RAW/atlas/obs"
get() { [ -s "$2" ] || curl -fsSL --retry 3 -o "$2" "$1"; }

# 1. CRU CL 2.0 climatology (New et al. 2002), 10 arc-minutes, as packaged by the NicheMapR project
get https://github.com/mrke/NicheMapR/releases/download/v2.0.0/global.climate.zip "$RAW/global_climate.zip"
[ -s "$RAW/global_climate.nc" ] || unzip -o -q "$RAW/global_climate.zip" global_climate.nc -d "$RAW"

# 2. GPCP v2.2 monthly precipitation 1979-2010, 2.5 degrees (copy in NCAR's GeoCAT sample data)
get https://raw.githubusercontent.com/NCAR/geocat-datafiles/main/netcdf_files/V22_GPCP.1979-2010.nc "$RAW/gpcp.nc"

# 3. Natural Earth vectors
NE=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
for f in ne_50m_admin_0_countries ne_50m_land ne_50m_ocean ne_50m_lakes ne_10m_geography_regions_polys; do
  get "$NE/$f.geojson" "$RAW/$f.geojson"
done

# 4. IPCC WGI AR6 Atlas: reference regions + CMIP6 regional means (land), W5E5 observations
ATLAS=https://raw.githubusercontent.com/IPCC-WG1/Atlas/main
get "$ATLAS/reference-regions/IPCC-WGI-reference-regions-v4.geojson" "$RAW/ar6.geojson"
if [ ! -d "$RAW/atlas_repo" ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/IPCC-WG1/Atlas.git "$RAW/atlas_repo"
  git -C "$RAW/atlas_repo" sparse-checkout set \
    datasets-aggregated-regionally/data/CMIP6/CMIP6_pr_land \
    datasets-aggregated-regionally/data/CMIP6/CMIP6_tas_land \
    datasets-aggregated-regionally/data/OBSERVATIONS/OBS_pr_land
fi
D="$RAW/atlas_repo/datasets-aggregated-regionally/data"
cp "$D"/CMIP6/CMIP6_pr_land/CMIP6_*.csv "$RAW/atlas/pr/"
cp "$D"/CMIP6/CMIP6_tas_land/CMIP6_*.csv "$RAW/atlas/tas/"
cp "$D"/OBSERVATIONS/OBS_pr_land/W5E5.csv "$RAW/atlas/obs/OBS_pr_land_W5E5.csv"

# 5. World Bank World Development Indicators (Open Numbers mirror, one CSV per indicator)
WDI=https://raw.githubusercontent.com/open-numbers/ddf--open_numbers--world_development_indicators/master/datapoints
for i in en_pop_dnst sl_agr_empl_zs nv_agr_totl_zs sp_pop_totl ag_lnd_totl_k2; do
  get "$WDI/ddf--datapoints--$i--by--geo--time.csv" "$RAW/wdi_$i.csv"
done
echo "Raw data ready in $RAW/"
