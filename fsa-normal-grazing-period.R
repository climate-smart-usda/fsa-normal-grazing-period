library(tidyverse)
library(magrittr)
library(khroma)
library(patchwork)

# Crops as defined by the FSA
fsa_crops <- 
  readxl::read_excel("data-raw/Crop Key 1.xlsx")

# FSA-defined Normal Grazing Periods (2022)
fsa_normal_grazing_period <-
  dplyr::bind_rows(readxl::read_excel("data-raw/2022GrazingPeriods.xlsx"),
                   readxl::read_excel("data-raw/AlaskaGrazing.xlsx") %>%
                     dplyr::rename(`Crop Type` = `Crop Type Code`,
                                   Use = `Crop Use`)
                   ) %>%
  tidyr::unite("FSA_CODE", c(`State Code`, `County Code`), sep = "") %>%
  dplyr::select(FSA_CODE, `Crop Code`, `Crop Type`, 
                `Grazing Period State Date`, `Grazing Period End Date`) %>%
  # This crop type seems to have been misstyped
  dplyr::mutate(`Crop Type` = ifelse(`Crop Type` == "EAS", "AES", `Crop Type`)) %>%
  dplyr::left_join(dplyr::select(fsa_crops,
                                 `Crop Code`,
                                 `Crop Name`,
                                 `Type Code`,
                                 `Type Name`), 
                   by = c("Crop Code", "Crop Type" = "Type Code")) %>%
  dplyr::select(!c(`Crop Code`, `Crop Type`)) %>%
  dplyr::mutate(dplyr::across(c(`Grazing Period State Date`, `Grazing Period End Date`), lubridate::as_date)) %>%
  dplyr::arrange(FSA_CODE, `Crop Name`, `Type Name`, `Grazing Period State Date`) %>%
  dplyr::select(FSA_CODE, `Crop Name`, `Type Name`, `Grazing Period State Date`, `Grazing Period End Date`) %T>%
  readr::write_csv("fsa-normal-grazing-period.csv")





## yday cyclic palette
dates <- seq(lubridate::as_date("1999-07-01"), lubridate::as_date("2000-06-30"), "1 day")
color_shift <- 250
colors <- as.character(khroma::color("romaO", reverse = TRUE)(366))
colors <- colors[c((color_shift + 1):366,1:color_shift)]

yday_pal <-
  tibble::tibble(date = dates,
                 color = colors,
                 yday = lubridate::yday(dates))

## yday cyclic legend
yday_legend <-
  yday_pal %>%
  ggplot2::ggplot(mapping = aes(x = date,
                                y = 1,
                                fill = color)) +
  geom_col(color = NA,
           linewidth = 0) +
  coord_polar(clip = "off") +
  scale_fill_identity() +
  scale_x_date(date_breaks = "month",
               date_labels = "%b"
  ) +
  ylim(-1,1.25) +
  theme_void(base_size = 24) +
  theme(legend.position = "none",
        axis.text.x = element_text(size = 16),
        axis.text.y = element_blank(),
        axis.title = element_blank(),
        panel.grid = element_blank()
  )

mean_yday_prep_start <- function(start, end){
  lubridate::year(start) <- ifelse(lubridate::month(start) > lubridate::month(end), 2000, 2001)

  return(start)

}

mean_yday_prep_end <- function(start, end){
  lubridate::year(end) <- 2001

  return(end)

}




lfp_growing_seasons <-
  lfp_eligibility %>%
  dplyr::select(PROGRAM_YEAR, FSA_CODE, PASTURE_TYPE, GROWING_SEASON_START, GROWING_SEASON_END) %>%
  dplyr::mutate(GROWING_SEASON_START = mean_yday_prep_start(GROWING_SEASON_START,GROWING_SEASON_END),
                GROWING_SEASON_END = mean_yday_prep_end(GROWING_SEASON_START,GROWING_SEASON_END)
  ) %>%
  dplyr::arrange(PASTURE_TYPE) %>%
  dplyr::group_by(FSA_CODE, PASTURE_TYPE) %>%
  dplyr::summarise(`Start Date` = lubridate::yday(mean(GROWING_SEASON_START, na.rm = TRUE)),
                   `End Date` = lubridate::yday(mean(GROWING_SEASON_END, na.rm = TRUE))) %>%
  dplyr::group_by(PASTURE_TYPE) %>%
  tidyr::nest() %>%
  dplyr::arrange(PASTURE_TYPE) %>%
  dplyr::rowwise() %>%
  dplyr::mutate(
    graph = list(
      (

        dplyr::left_join(conus, data,
                         by = c("county_fips" = "FSA_CODE")) %>%
          tidyr::pivot_longer(`Start Date`:`End Date`) %>%
          dplyr::mutate(name = factor(name,
                                      levels = c("Start Date",
                                                 "End Date"),
                                      ordered = TRUE)) %>%
          dplyr::left_join(yday_pal,
                           by = c("value" = "yday")) %>%
          dplyr::mutate(color = tidyr::replace_na(color, "grey80")) %>%
          ggplot2::ggplot() +
          geom_sf(aes(fill = color),
                  col = "white") +
          geom_sf(data = conus %>%
                    dplyr::group_by(state_fips) %>%
                    dplyr::summarise(),
                  col = "white",
                  fill = NA,
                  linewidth = 0.5) +
          scale_fill_identity(na.value = "grey80") +
          ggplot2::labs(title = PASTURE_TYPE,
                        subtitle = "Normal Grazing Period") +
          theme_void(base_size = 24) +
          theme(  plot.title = element_text(hjust = 0.5),
                  plot.subtitle = element_text(hjust = 0.5),
                  legend.position = c(0.5,0.125),
                  legend.title = element_text(size = 14),
                  legend.text = element_text(size = 12),
                  strip.text.x = element_text(margin = margin(b = 5))) +
          ggplot2::facet_grid(cols = dplyr::vars(name)) +
          patchwork::inset_element(yday_legend,
                                   left = 0.3,
                                   right = 0.7,
                                   bottom = 0,
                                   top = 0.4)

      )
    )
  )

unlink("fsa-lfp-grazing-periods.pdf")

cairo_pdf(filename = "fsa-lfp-grazing-periods.pdf",
          width = 16,
          height = 6.86,
          bg = "white",
          onefile = TRUE)

lfp_growing_seasons$graph

dev.off()

### 2022 Normal Grazing Periods (via Holly Prendeville)
conus_names <-
  conus %>%
  dplyr::select(CONUS_CODE = county_fips,
                CONUS_STATE = state_name,
                CONUS_COUNTY = county_name) %>%
  sf::st_drop_geometry() %>%
  dplyr::arrange(CONUS_CODE) %>%
  dplyr::distinct()

fsa_names <-
  readxl::read_excel("data-raw/fsa-lfp-grazing-periods/2022GrazingPeriods.xlsx") %>%
  dplyr::bind_rows(
    readxl::read_excel("data-raw/fsa-lfp-grazing-periods/AlaskaGrazing.xlsx") %>%
      dplyr::rename(`County Name` = `County name`)
  ) %>%
  dplyr::filter(`State Name` != "Puerto Rico") %>%
  dplyr::transmute(FSA_CODE = paste0(`State Code`, `County Code`),
                   FSA_STATE = `State Name`,
                   FSA_COUNTY = `County Name`) %>%
  dplyr::distinct() %>%
  dplyr::arrange(FSA_CODE)


# fsa_names <-
#   readr::read_csv("https://raw.githubusercontent.com/mt-climate-office/fsa-lfp-eligibility/main/fsa-lfp-eligibility.csv") %>%
#   dplyr::transmute(FSA_CODE,
#                    FSA_STATE,
#                    FSA_COUNTY = FSA_COUNTY_NAME) %>%
#   dplyr::filter(FSA_STATE != "52-VI",
#                 FSA_STATE != "72-PR") %>%
#   dplyr::distinct() %>%
#   dplyr::arrange(FSA_CODE)


bind_rows(
  anti_join(fsa_names,
            conus_names,
            by = c("FSA_CODE" = "CONUS_CODE")),
  anti_join(conus_names,
            fsa_names,
            by = c("CONUS_CODE" = "FSA_CODE"))
)




ngp_2022 <-
  readxl::read_excel("data-raw/fsa-lfp-grazing-periods/2022GrazingPeriods.xlsx") %>%
  dplyr::mutate(FSA_CODE = paste0(`State Code`, `County Code`),
                dplyr::across(`Grazing Period State Date`:`Grazing Period End Date`, lubridate::as_date)) %>%
  dplyr::select(-Use, -`Planting Period`) %>%
  dplyr::left_join(
    readxl::read_excel("data-raw/fsa-lfp-grazing-periods/Crop Key 1.xlsx") %>%
      dplyr::select(`Type Name`,
                    `Type Code`,
                    `Crop Code`),
    by = c("Crop Type" = "Type Code",
           "Crop Code" = "Crop Code"
    )) %>%
  dplyr::transmute(
    FSA_CODE,
    STATE = `State Name`,
    COUNTY = `County Name`,
    `Crop Type` = stringr::str_to_title(`Crop Name`),
    `Crop Name` = `Type Name`,
    Practice = factor(Practice,
                      levels = c("N", "I"),
                      labels = c("Non-irrigated", "Irrigated"),
                      ordered = TRUE),
    `Grazing Period State Date`,
    `Grazing Period End Date`
  )

#
# %>%
#   dplyr::group_by(across(c(-`Crop Name`))) %>%
#   dplyr::summarise(`Crop Names` = paste0(`Crop Name`, collapse = "; "),
#                    .groups = "drop")
#
#
#
#
#   dplyr::group_by(PASTURE_TYPE) %>%
#   tidyr::nest() %>%
#   dplyr::arrange(PASTURE_TYPE) %>%
#   dplyr::rowwise() %>%
#   dplyr::mutate(
#     graph = list(
#       (
#
#         dplyr::left_join(conus, data,
#                          by = c("GEOID" = "FSA_CODE")) %>%
#           tidyr::pivot_longer(`Start Date`:`End Date`) %>%
#           dplyr::mutate(name = factor(name,
#                                       levels = c("Start Date",
#                                                  "End Date"),
#                                       ordered = TRUE)) %>%
#           dplyr::left_join(yday_pal,
#                            by = c("value" = "yday")) %>%
#           dplyr::mutate(color = tidyr::replace_na(color, "grey80")) %>%
#           ggplot2::ggplot() +
#           geom_sf(aes(fill = color),
#                   col = "white") +
#           geom_sf(data = conus %>%
#                     dplyr::group_by(STATEFP) %>%
#                     dplyr::summarise(),
#                   col = "white",
#                   fill = NA,
#                   linewidth = 0.5) +
#           scale_fill_identity(na.value = "grey80") +
#           ggplot2::labs(title = PASTURE_TYPE,
#                         subtitle = "Normal Grazing Period") +
#           theme_void(base_size = 24) +
#           theme(  plot.title = element_text(hjust = 0.5),
#                   plot.subtitle = element_text(hjust = 0.5),
#                   legend.position = c(0.5,0.125),
#                   legend.title = element_text(size = 14),
#                   legend.text = element_text(size = 12),
#                   strip.text.x = element_text(margin = margin(b = 5))) +
#           ggplot2::facet_grid(cols = dplyr::vars(name)) +
#           patchwork::inset_element(yday_legend,
#                                    left = 0.3,
#                                    right = 0.7,
#                                    bottom = 0,
#                                    top = 0.4)
#
#       )
#     )
#   )
#
# unlink("fsa-lfp-grazing-periods-2022.pdf")
#
# cairo_pdf(filename = "fsa-lfp-grazing-periods-2022.pdf",
#           width = 16,
#           height = 6.86,
#           bg = "white",
#           onefile = TRUE)
#
# ngp_2022$graph
#
# dev.off()

### Standards for Calculating Normal Grazing Periods
full_season <-
  arrow::read_feather("~/git/mt-climate-office/nclimgrid-normal-grazing-period/nclimgrid-normal-grazing-period.arrow") %>%
  as.data.frame(xy = TRUE) %>%
  magrittr::set_names(c("x","y","Start Date","End Date")) %>%
  dplyr::mutate(Season = "Full Season") %>%
  tidyr::pivot_longer(`Start Date`:`End Date`,
                      names_to = "Type",
                      values_to = "yday")


full_season <-
  terra::rast("~/git/mt-climate-office/nclimgrid-normal-grazing-period/data-derived/full_season_round.nc") %>%
  terra::as.points() %>%
  sf::st_as_sf() %>%
  sf::st_transform("EPSG:5070") %>%
  sf::st_intersection(conus %>%
                        sf::st_transform("EPSG:5070")) %>%
  dplyr::select(full_season_start = full_season_round_1,
                full_season_end = full_season_round_2,
                GEOID) %>%
  sf::st_drop_geometry() %>%
  dplyr::mutate(dplyr::across(full_season_start:full_season_end, ~as.Date(., origin = '2017-12-31')),
                full_season_end = ifelse(full_season_end <= full_season_start,
                                         full_season_end + lubridate::years(1),
                                         full_season_end),
                full_season_end = lubridate::as_date(full_season_end)) %>%
  tibble::as_tibble() %>%
  dplyr::group_by(GEOID) %>%
  dplyr::summarise(full_season_start = lubridate::yday(min(full_season_start, na.rm = TRUE)),
                   full_season_end = lubridate::yday(max(full_season_end, na.rm = TRUE))) %>%
  dplyr::left_join(conus, .)

nclimgrid <-
  terra::rast("~/git/mt-climate-office/nclimgrid-normal-grazing-period/data-derived/cool_season_round.nc") %>%
  magrittr::set_names(c("start", "end")) %>%
  terra::as.points() %>%
  sf::st_as_sf() %>%
  dplyr::mutate(type = "Cool Season") %>%
  dplyr::bind_rows(terra::rast("~/git/mt-climate-office/nclimgrid-normal-grazing-period/data-derived/full_season_round.nc") %>%
                     magrittr::set_names(c("start", "end")) %>%
                     terra::as.points() %>%
                     sf::st_as_sf() %>%
                     dplyr::mutate(type = "Full Season")) %>%
  sf::st_transform("EPSG:5070") %>%
  sf::st_intersection(conus %>%
                        sf::st_transform("EPSG:5070")) %>%
  dplyr::select(start,
                end,
                type,
                GEOID) %>%
  sf::st_drop_geometry() %>%
  dplyr::mutate(dplyr::across(start:end, ~as.Date(., origin = '2017-12-31')),
                end = ifelse(end <= start,
                             end + lubridate::years(1),
                             end),
                end = lubridate::as_date(end)) %>%
  tibble::as_tibble() %>%
  dplyr::group_by(type,GEOID) %>%
  dplyr::summarise(start = lubridate::yday(min(start, na.rm = TRUE)),
                   end = lubridate::yday(max(end, na.rm = TRUE)))


nclimgrid %<>%
  dplyr::rename(`Start Date` = start,
                `End Date` = end) %>%
  dplyr::arrange(type) %>%
  # dplyr::group_by(FSA_CODE, PASTURE_TYPE) %>%
  # dplyr::summarise(`Start Date` = lubridate::yday(mean(GROWING_SEASON_START, na.rm = TRUE)),
  #                  `End Date` = lubridate::yday(mean(GROWING_SEASON_END, na.rm = TRUE))) %>%
  dplyr::group_by(type) %>%
  tidyr::nest() %>%
  dplyr::arrange(type) %>%
  dplyr::rowwise() %>%
  dplyr::mutate(
    graph = list(
      (
        dplyr::left_join(conus %>%
                           sf::st_transform(5070) %>%
                           rmapshaper::ms_simplify(), data) %>%
          tidyr::pivot_longer(`Start Date`:`End Date`) %>%
          dplyr::mutate(name = factor(name,
                                      levels = c("Start Date",
                                                 "End Date"),
                                      ordered = TRUE)) %>%
          dplyr::left_join(yday_pal,
                           by = c("value" = "yday")) %>%
          dplyr::mutate(color = tidyr::replace_na(color, "grey80")) %>%
          ggplot2::ggplot() +
          geom_sf(aes(fill = color),
                  col = "white") +
          geom_sf(data = conus %>%
                    dplyr::group_by(STATEFP) %>%
                    dplyr::summarise(),
                  col = "white",
                  fill = NA,
                  linewidth = 0.5) +
          scale_fill_identity(na.value = "grey80") +
          ggplot2::labs(title = type,
                        subtitle = "Normal Grazing Period") +
          theme_void(base_size = 24) +
          theme(  plot.title = element_text(hjust = 0.5),
                  plot.subtitle = element_text(hjust = 0.5),
                  legend.position = c(0.5,0.125),
                  legend.title = element_text(size = 14),
                  legend.text = element_text(size = 12),
                  strip.text.x = element_text(margin = margin(b = 5))) +
          ggplot2::facet_grid(cols = dplyr::vars(name)) +
          patchwork::inset_element(yday_legend,
                                   left = 0.3,
                                   right = 0.7,
                                   bottom = 0,
                                   top = 0.4)

      )
    )
  )

unlink("fsa-lfp-grazing-periods-nclimgrid.pdf")

cairo_pdf(filename = "fsa-lfp-grazing-periods-nclimgrid.pdf",
          width = 16,
          height = 6.86,
          bg = "white",
          onefile = TRUE)

nclimgrid$graph

dev.off()

# dplyr::bind_rows(full_season, cool_season)
full_season %>%
  dplyr::mutate(Type = factor(Type,
                              levels = c("Start Date",
                                         "End Date"),
                              ordered = TRUE)) %>%
  dplyr::left_join(yday_pal,
                   by = c("yday" = "yday"),
                   multiple = "all") %>%
  dplyr::mutate(color = tidyr::replace_na(color, "grey80")) %>%
  ggplot2::ggplot(aes(x = x,
                      y = y,
                      fill = color)) +
  geom_raster() +
  geom_sf(data = conus %>%
            dplyr::group_by(STATEFP) %>%
            dplyr::summarise(),
          col = "white",
          fill = NA,
          linewidth = 0.5) +
  scale_fill_identity(na.value = "grey80") +
  ggplot2::labs(title = "NAP-190",
                subtitle = "Idealized Normal Grazing Period") +
  theme_void(base_size = 24) +
  theme(  plot.title = element_text(hjust = 0.5),
          plot.subtitle = element_text(hjust = 0.5),
          legend.position = c(0.5,0.125),
          legend.title = element_text(size = 14),
          legend.text = element_text(size = 12),
          strip.text.x = element_text(margin = margin(b = 5))) +
  ggplot2::facet_grid(cols = dplyr::vars(Type)) +
  patchwork::inset_element(yday_legend,
                           left = 0.3,
                           right = 0.7,
                           bottom = 0,
                           top = 0.4)

lfp_eligibility %>%
  # dplyr::filter(!(FSA_CODE %in% conus$county_fips)) %>%
  dplyr::select(FSA_CODE, FSA_STATE, FSA_COUNTY_NAME) %>%
  dplyr::arrange(FSA_CODE) %>%
  dplyr::distinct()


lfp_eligibility %>%
  dplyr::select(PROGRAM_YEAR, FSA_CODE, FSA_COUNTY_NAME, FSA_STATE, PASTURE_TYPE, PASTURE_CODE, GROWING_SEASON_START, GROWING_SEASON_END) %>%
  dplyr::distinct() %>%
  dplyr::arrange(FSA_CODE, PASTURE_TYPE, PROGRAM_YEAR)



# Grazing Periods from Three Sources

ngp_2022 <-
  readxl::read_excel("data-raw/fsa-lfp-grazing-periods/2022GrazingPeriods.xlsx") %>%
  dplyr::mutate(FSA_CODE = paste0(`State Code`, `County Code`),
                dplyr::across(`Grazing Period State Date`:`Grazing Period End Date`, lubridate::as_date)) %>%
  dplyr::select(-Use, -`Planting Period`) %>%
  dplyr::left_join(
    readxl::read_excel("data-raw/fsa-lfp-grazing-periods/Crop Key 1.xlsx") %>%
      dplyr::select(`Type Name`,
                    `Type Code`,
                    `Crop Code`),
    by = c("Crop Type" = "Type Code",
           "Crop Code" = "Crop Code"
    )) %>%
  dplyr::transmute(
    FSA_CODE,
    STATE = `State Name`,
    COUNTY = `County Name`,
    `Crop Type` = stringr::str_to_title(`Crop Name`),
    `Crop Name` = `Type Name`,
    Practice = factor(Practice,
                      levels = c("N", "I"),
                      labels = c("Non-irrigated", "Irrigated"),
                      ordered = TRUE),
    `Grazing Period State Date`,
    `Grazing Period End Date`
  ) %>%
  dplyr::group_by(across(c(-`Crop Name`))) %>%
  dplyr::summarise(`Crop Names` = paste0(`Crop Name`, collapse = "; "),
                   .groups = "drop")

library(magrittr)
readr::read_csv("data-raw/lfp/FY2021_012_Assistance_Full_20220908/FY2021_012_Assistance_Full_20220909_7.csv") %>%
  magrittr::extract(1,) %>%
  as.list()
