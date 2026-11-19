"""Map 01 - Where are the driest places on Earth?

Inputs (see README for download links)
  raw/global_climate.nc   CRU CL 2.0 10' climatology 1961-1990 (New et al. 2002),
                          as packaged by NicheMapR (bands 2-13 rainfall, 38-49 tmin, 50-61 tmax)
  raw/gpcp.nc             GPCP v2.2 monthly precipitation 1979-2010, 2.5 deg (Antarctica only)
  raw/ne_*.geojson        Natural Earth land, countries, physical regions

Outputs
  data/dryness.png        data-encoded raster, 2160x1080, plate carree
                          R,G = annual precipitation (mm, 16 bit, 65535 = no data)
                          B   = aridity index P/PET * 100 (0-250 clipped, 255 = no data)
                          A   = 255
  data/map01.json         class shares, driest deserts, driest countries
"""
import json
import sys
import numpy as np
import netCDF4
from PIL import Image
from common import load_geojson, rasterize, cell_area_weights, iso3, nice_name

RAW, OUT = sys.argv[1], sys.argv[2]
NX, NY = 2160, 1080

# ---------------------------------------------------------------- CRU CL 2.0
nc = netCDF4.Dataset(f"{RAW}/global_climate.nc")
v = nc["variable"]
v.set_auto_maskandscale(False)
pr = v[1:13].astype(np.float32)            # mm / month
nodata = pr[0] == -32768
tmin = v[37:49].astype(np.float32) / 10.0  # deg C
tmax = v[49:61].astype(np.float32) / 10.0
precip = pr.sum(0)
precip[nodata] = np.nan

# ------------------------------------------- Hargreaves reference evapotranspiration
lat = np.radians(90 - (np.arange(NY) + 0.5) * 180.0 / NY)
mid_doy = np.array([15, 46, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344])
days = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
pet = np.zeros((NY, NX), np.float32)
for m in range(12):
    j = mid_doy[m]
    dr = 1 + 0.033 * np.cos(2 * np.pi * j / 365)
    dec = 0.409 * np.sin(2 * np.pi * j / 365 - 1.39)
    ws = np.arccos(np.clip(-np.tan(lat) * np.tan(dec), -1, 1))
    ra = (24 * 60 / np.pi) * 0.0820 * dr * (
        ws * np.sin(lat) * np.sin(dec) + np.cos(lat) * np.cos(dec) * np.sin(ws))
    ra = np.clip(ra, 0, None)[:, None]                      # MJ m-2 day-1
    tmean = (tmin[m] + tmax[m]) / 2
    trange = np.clip(tmax[m] - tmin[m], 0, None)
    et0 = 0.0023 * 0.408 * ra * (tmean + 17.8) * np.sqrt(trange)   # mm / day
    pet += np.clip(et0, 0, None) * days[m]
pet[nodata] = np.nan
with np.errstate(divide="ignore", invalid="ignore"):
    ai = precip / pet
ai[~np.isfinite(ai)] = np.nan
ai[(pet < 1) & ~nodata] = 9.99          # no evaporative demand -> humid / cold

# ------------------------------------------------ Antarctica from GPCP v2.2
g = netCDF4.Dataset(f"{RAW}/gpcp.nc")
P = g["PREC"][:].filled(np.nan)                      # mm/day, [384, 72, 144], lat S->N, lon 0..360
glat, glon = g["lat"][:], g["lon"][:]
gp_ann = np.nanmean(P.reshape(32, 12, 72, 144) * days[None, :, None, None], axis=0).sum(0)
gp_ann = np.roll(gp_ann[::-1], 72, axis=1)           # -> N->S, lon -180..180
glat = glat[::-1]
glon = np.where(glon > 180, glon - 360, glon)
glon = np.roll(glon, 72)
# bilinear upsample to the 10' grid
tlat = 90 - (np.arange(NY) + 0.5) * 180.0 / NY
tlon = -180 + (np.arange(NX) + 0.5) * 360.0 / NX
fi = np.clip((glat[0] - tlat) / 2.5, 0, 71)
fj = ((tlon - glon[0]) / 2.5) % 144
i0 = np.floor(fi).astype(int); i1 = np.clip(i0 + 1, 0, 71); wi = (fi - i0)[:, None]
j0 = np.floor(fj).astype(int); j1 = (j0 + 1) % 144; wj = (fj - j0)[None, :]
gp_hi = ((1 - wi) * (1 - wj) * gp_ann[i0][:, j0] + (1 - wi) * wj * gp_ann[i0][:, j1]
         + wi * (1 - wj) * gp_ann[i1][:, j0] + wi * wj * gp_ann[i1][:, j1])

land = load_geojson(f"{RAW}/ne_50m_land.geojson")
land_mask = np.zeros((NY, NX), bool)
for f in land["features"]:
    land_mask |= rasterize(f["geometry"], NX, NY)
antarctica = land_mask & (tlat[:, None] < -60) & np.isnan(precip)
precip_all = precip.copy()
precip_all[antarctica] = gp_hi[antarctica]

# --------------------------------------------------------- encode data PNG
p16 = np.where(np.isnan(precip_all), 65535, np.clip(np.round(precip_all), 0, 65000)).astype(np.uint16)
a8 = np.where(np.isnan(ai), 255, np.clip(np.round(ai * 100), 0, 250)).astype(np.uint8)
rgba = np.dstack([(p16 >> 8).astype(np.uint8), (p16 & 255).astype(np.uint8), a8,
                  np.full((NY, NX), 255, np.uint8)])
Image.fromarray(rgba, "RGBA").save(f"{OUT}/dryness.png", optimize=True)

# ------------------------------------------------------------------ statistics
w = cell_area_weights(NY, NX)
P_BREAKS = [25, 100, 250, 500, 1000, 2000]
A_BREAKS = [0.05, 0.2, 0.5, 0.65]


def shares(arr, breaks, valid):
    tot = w[valid].sum()
    cls = np.digitize(arr[valid], breaks)
    return [round(float(w[valid][cls == k].sum() / tot * 100), 1) for k in range(len(breaks) + 1)]


valid_all = ~np.isnan(precip_all)
valid_cru = ~np.isnan(precip)
stats = {
    "precip_breaks": P_BREAKS,
    "precip_share_land": shares(precip_all, P_BREAKS, valid_all),
    "precip_share_land_excl_antarctica": shares(precip, P_BREAKS, valid_cru),
    "aridity_breaks": A_BREAKS,
    "aridity_share_land_excl_antarctica": shares(ai, A_BREAKS, valid_cru & ~np.isnan(ai)),
    "antarctica_mean_mm": round(float((precip_all * w)[antarctica].sum() / w[antarctica].sum())),
    "land_mean_mm_excl_antarctica": round(float((precip * w)[valid_cru].sum() / w[valid_cru].sum())),
}

# major named deserts (Natural Earth physical regions), driest first
DESERTS = {"WESTERN DESERT": "Western Desert, Egypt", "TAKLIMAKAN DESERT": "Taklamakan",
           "DESIERTO DE ATACAMA": "Atacama", "RUB\u2019 AL KHALI": "Rub\u2019 al Khali",
           "LUT DESERT": "Dasht-e Lut", "NAMIB DESERT": "Namib", "SAHARA": "Sahara (whole)",
           "GARAGUM DESERT": "Karakum", "GOBI DESERT": "Gobi", "GREAT VICTORIA DESERT": "Great Victoria",
           "THAR DESERT": "Thar", "SONORAN DESERT": "Sonoran", "KALAHARI DESERT": "Kalahari"}
regions = load_geojson(f"{RAW}/ne_10m_geography_regions_polys.geojson")
deserts = []
for f in regions["features"]:
    p = f["properties"]
    if p["FEATURECLA"] != "Desert" or p["NAME"] not in DESERTS:
        continue
    m = rasterize(f["geometry"], NX, NY) & valid_cru
    ii, jj = np.where(m)
    k = int(np.nanargmin(precip[m]))
    deserts.append({
        "name": DESERTS[p["NAME"]],
        "mean_mm": round(float((precip * w)[m].sum() / w[m].sum())),
        "min_mm": round(float(precip[m][k])),
        "lon": round(float((tlon[jj] * w[m]).sum() / w[m].sum()), 2),
        "lat": round(float((tlat[ii] * w[m]).sum() / w[m].sum()), 2),
    })
deserts.sort(key=lambda d: d["mean_mm"])
missing = set(DESERTS.values()) - {d["name"] for d in deserts}
assert not missing, missing
stats["deserts"] = deserts
stats["antarctica_min_mm"] = round(float(np.nanmin(precip_all[antarctica])))
# The map raster stops at the Web-Mercator limit (85.05 S). The cap beyond it is drawn in one colour:
# the median of the last ring the raster does show (84-85 S), so that it blends in.
ring = slice(NY - 36, NY - 30)
stats["pole_mm"] = round(float(np.nanmedian(precip_all[ring][antarctica[ring]])))

# driest countries (area-weighted grid mean)
countries = load_geojson(f"{RAW}/ne_50m_admin_0_countries.geojson")
rows = []
for f in countries["features"]:
    p = f["properties"]
    m = rasterize(f["geometry"], NX, NY) & valid_cru
    if m.sum() < 12:            # skip micro-states: fewer than 12 cells (~4,000 km2 at the equator)
        continue
    ws = w[m].sum()
    rows.append({
        "iso3": iso3(p), "name": nice_name(p),
        "mean_mm": round(float((precip * w)[m].sum() / ws)),
        "share_lt250": round(float(w[m][precip[m] < 250].sum() / ws * 100)),
        "lon": round(float(p["LABEL_X"]), 2), "lat": round(float(p["LABEL_Y"]), 2),
    })
rows.sort(key=lambda r: r["mean_mm"])
stats["countries"] = rows

with open(f"{OUT}/map01.json", "w", encoding="utf8") as f:
    json.dump(stats, f, ensure_ascii=False, separators=(",", ":"))

print({k: stats[k] for k in stats if k not in ("deserts", "countries")})
print("deserts:", [(d["name"], d["mean_mm"], d["min_mm"]) for d in deserts[:14]])
print("countries:", [(r["name"], r["mean_mm"]) for r in rows[:14]])
