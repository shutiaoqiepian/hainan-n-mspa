# Open-Meteo 变量实测核实

> 生成时间：2026-10-31T18:22:04.212Z　生成脚本：`tools/probe-openmeteo-vars.mjs`
> 方法：**逐个变量真实调用接口**并读返回值（文档页太长抓不全，直接问接口最准）。
> 测点：海南 19.9°N, 110.3°E；取当地 18:00（日落附近）的实际数值。

## 一、地面 / 单层变量

| 变量 | 参数名 | 可用 | 实测值 | 单位 |
|---|---|---|---|---|
| 云量·总 | `cloud_cover` | ✅ | 100 | % |
| 云量·低 | `cloud_cover_low` | ✅ | 39 | % |
| 云量·中 | `cloud_cover_mid` | ✅ | 5 | % |
| 云量·高 | `cloud_cover_high` | ✅ | 100 | % |
| 云底高度 | `cloud_base` | ✅ | null | undefined |
| 云顶高度 | `cloud_top` | ✅ | null | undefined |
| 可降水量 | `total_column_integrated_water_vapour` | ✅ | 49.5 | kg/m² |
| CAPE | `cape` | ✅ | 1650 | J/kg |
| CIN | `convective_inhibition` | ✅ | 10 | J/kg |
| 边界层高度 | `boundary_layer_height` | ✅ | 410 | m |
| 能见度 | `visibility` | ✅ | 9580 | m |
| 短波辐射 | `shortwave_radiation` | ✅ | 50 | W/m² |
| 直接法向辐射 | `direct_normal_irradiance` | ✅ | 77.5 | W/m² |
| 散射辐射 | `diffuse_radiation` | ✅ | 39 | W/m² |
| 直接辐射 | `direct_radiation` | ✅ | 11 | W/m² |
| 降水 | `precipitation` | ✅ | 0.5 | mm |
| 降水概率 | `precipitation_probability` | ✅ | 37 | % |
| 气温 2m | `temperature_2m` | ✅ | 26 | °C |
| 露点 2m | `dew_point_2m` | ✅ | 24.8 | °C |
| 相对湿度 2m | `relative_humidity_2m` | ✅ | 93 | % |
| 风速 10m | `wind_speed_10m` | ✅ | 6.7 | km/h |
| 风向 10m | `wind_direction_10m` | ✅ | 104 | ° |
| 气压·地面 | `surface_pressure` | ✅ | 1006.1 | hPa |
| 气压·海平面 | `sea_level_pressure` | ❌ | — |  |
| 冻结高度 | `freezing_level_height` | ✅ | 5160 | m |
| 零度层高度 | `zero_degree_level` | ❌ | — |  |

## 二、压力层变量

| 变量 | 参数名模板 | 850hPa 可用 | 实测值 | 单位 |
|---|---|---|---|---|
| 云量 | `cloud_cover_{L}hPa` | ✅ | 11 | % |
| 相对湿度 | `relative_humidity_{L}hPa` | ✅ | 82 | % |
| 温度 | `temperature_{L}hPa` | ✅ | 18.6 | °C |
| 露点 | `dew_point_{L}hPa` | ✅ | 15.5 | °C |
| 位势高度 | `geopotential_height_{L}hPa` | ✅ | 1539 | m |
| 风速 | `wind_speed_{L}hPa` | ✅ | 6.7 | km/h |
| 风向 | `wind_direction_{L}hPa` | ✅ | 118 | ° |
| U 风 | `u_component_of_wind_{L}hPa` | ❌ | — |  |
| V 风 | `v_component_of_wind_{L}hPa` | ❌ | — |  |
| 垂直速度 | `vertical_velocity_{L}hPa` | ✅ | 0 | m/s |
| 比湿 | `specific_humidity_{L}hPa` | ❌ | — |  |
| 云水 | `cloud_liquid_water_{L}hPa` | ❌ | — |  |
| 云冰 | `cloud_ice_{L}hPa` | ❌ | — |  |
| 云水含量 | `cloud_water_content_{L}hPa` | ❌ | — |  |
| 位温 | `potential_temperature_{L}hPa` | ❌ | — |  |

### 各变量实际可用的气压层级

- **云量**：1000 / 950 / 925 / 900 / 850 / 800 / 700 / 600 / 500 / 400 / 300 / 250 / 200 / 150 / 100 / 70 / 50 hPa
- **相对湿度**：1000 / 950 / 925 / 900 / 850 / 800 / 700 / 600 / 500 / 400 / 300 / 250 / 200 / 150 / 100 / 70 / 50 hPa
- **温度**：1000 / 950 / 925 / 900 / 850 / 800 / 700 / 600 / 500 / 400 / 300 / 250 / 200 / 150 / 100 / 70 / 50 hPa
- **露点**：1000 / 950 / 925 / 900 / 850 / 800 / 700 / 600 / 500 / 400 / 300 / 250 / 200 / 150 / 100 / 70 / 50 hPa
- **位势高度**：1000 / 950 / 925 / 900 / 850 / 800 / 700 / 600 / 500 / 400 / 300 / 250 / 200 / 150 / 100 / 70 / 50 hPa
- **风速**：1000 / 950 / 925 / 900 / 850 / 800 / 700 / 600 / 500 / 400 / 300 / 250 / 200 / 150 / 100 / 70 / 50 hPa
- **风向**：1000 / 950 / 925 / 900 / 850 / 800 / 700 / 600 / 500 / 400 / 300 / 250 / 200 / 150 / 100 / 70 / 50 hPa
- **垂直速度**：1000 / 950 / 925 / 900 / 850 / 800 / 700 / 600 / 500 / 400 / 300 / 250 / 200 / 150 / 100 / 70 / 50 hPa

## 三、气溶胶（Air Quality API，底层为 CAMS）

| 变量 | 参数名 | 可用 | 实测值 | 单位 |
|---|---|---|---|---|
| 气溶胶光学厚度 | `aerosol_optical_depth` | ✅ | 0.16 |  |
| PM2.5 | `pm2_5` | ✅ | 9.1 | μg/m³ |
| PM10 | `pm10` | ✅ | 12.3 | μg/m³ |
| 沙尘 | `dust` | ✅ | 0 | μg/m³ |
| UV 指数 | `uv_index` | ✅ | 0 |  |
| 一氧化碳 | `carbon_monoxide` | ✅ | 214 | μg/m³ |
| 二氧化氮 | `nitrogen_dioxide` | ✅ | 3 | μg/m³ |
| 臭氧 | `ozone` | ✅ | 92 | μg/m³ |
| 二氧化硫 | `sulphur_dioxide` | ✅ | 1.5 | μg/m³ |
| 氨 | `ammonia` | ✅ | null | μg/m³ |
| 海盐 AOD | `sea_salt_aerosol_optical_depth` | ❌ | — |  |
| 有机物 AOD | `organic_matter_aerosol_optical_depth` | ❌ | — |  |
| 黑碳 AOD | `black_carbon_aerosol_optical_depth` | ❌ | — |  |
| 沙尘 AOD | `dust_aerosol_optical_depth` | ❌ | — |  |
| 硫酸盐 AOD | `sulphate_aerosol_optical_depth` | ❌ | — |  |
| AOD 550nm | `aerosol_optical_depth_550nm` | ❌ | — |  |

## 四、结论

- **有**：多模式、压力层的云量/湿度/温度/位势高度/风/垂直速度，足够做垂直廓线与多层云结构。
- **没有**：云水混合比、云冰混合比、比湿、模式层数据、任何三维体数据。
  → 任务书 3.4 里第一优先级的「模式直接提供的三维云水/云冰场」**Open-Meteo 拿不到**，
  只能用第二/第三优先级的云量诊断值，界面上必须标注为估算。
- **水平方向**：接口只接受「点列表」，不接受路径/区域；
  要画水平—垂直截面，必须自己在路径上取 ~20–40 个点逐点请求。
