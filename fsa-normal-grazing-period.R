library(tidyverse)
library(magrittr)
library(khroma)
library(patchwork)

# FSA-defined Normal Grazing Periods (2022)
fsa_normal_grazing_period <-
  unzip(zipfile = "foia/2025-FSA-04691-F Bocinsky.zip",
        files = "LFP_NormalGrazingPeriodsReport.xlsx",
        exdir = tempdir()) %>%
  readxl::read_excel() %>%
  # Some start and end dates are NA — remove
  dplyr::filter(!is.na(`Normal Grazing Period Start Date`)) %>%
  tidyr::unite(col = "FSA Code",
               c(`State FSA Code`, `County FSA Code`), 
               sep = "", 
               remove = FALSE) %>%
  dplyr::rename(`Pasture Type` = `Pasture Grazing Type`) %>%
  dplyr::arrange(`FSA Code`, `Pasture Type`, `Program Year`) %>%
  dplyr::mutate(`Normal Grazing Period Start Date` = lubridate::as_date(`Normal Grazing Period Start Date`),
                `Normal Grazing Period End Date` = lubridate::as_date(`Normal Grazing Period End Date`),) %>%
  # Split northern and southern Shoshone County, ID, which are separated in the FSA county dataset
  dplyr::left_join(tibble::tibble(`FSA Code` = c("16079", "16079"),
                                  `New Code` = c("16055", "16009")),
                   relationship = "many-to-many") %>%
  dplyr::mutate(`FSA Code` = ifelse(!is.na(`New Code`), `New Code`, `FSA Code`),
                # Correct name of "Full Season Improved Mixed Pasture" in certain records
                `Pasture Type` = dplyr::case_match(`Pasture Type`,
                                                   "Full Season Improved Mixed Pastures" ~ "Full Season Improved Mixed Pasture",
                                                   .default = `Pasture Type`),
                # Correct erroneous year in duplicated start date of two 2010 Utah records
                `Normal Grazing Period Start Date` = 
                  case_when(`Program Year` == 2010 & `FSA Code` %in% c("49031", "49041") ~ lubridate::as_date("2010-04-01"),
                            .default = `Normal Grazing Period Start Date`),
                # Correct erroneous Native Pasture duplicated start date in 2012 Kansas data (should be 2012-05-01)
                `Normal Grazing Period Start Date` = 
                  case_when(`Program Year` == 2012 & `State Name` == "Kansas" ~ lubridate::as_date("2012-05-01"),
                            .default = `Normal Grazing Period Start Date`),
                # Correct erroneous Native Pasture duplicated start date in 2013 Kansas data (should be 2013-05-01)
                `Normal Grazing Period Start Date` = 
                  case_when(`Program Year` == 2013 & `State Name` == "Kansas" ~ lubridate::as_date("2013-05-01"),
                            .default = `Normal Grazing Period Start Date`),
                # Correct erroneous Native Pasture duplicated start date in 2014 Kansas data (should be 2014-05-01)
                `Normal Grazing Period Start Date` = 
                  case_when(`Program Year` == 2014 & `State Name` == "Kansas" ~ lubridate::as_date("2014-05-01"),
                            .default = `Normal Grazing Period Start Date`),
                # Correct erroneous Forage Sorghum duplicated start date in 2016 Mississippi data (should be 2016-06-01)
                `Normal Grazing Period Start Date` = 
                  case_when(`Program Year` == 2016 & `State Name` == "Mississippi" ~ lubridate::as_date("2016-06-01"),
                            .default = `Normal Grazing Period Start Date`),
                # Correct erroneous duplicated end date in 2016 (all forage types) in
                # Prairie County, MT data (should be 2016-12-01 based on surrounding counties)
                `Normal Grazing Period End Date` = 
                  case_when(`Program Year` == 2016 & `FSA Code` == "30079" ~ lubridate::as_date("2016-12-01"),
                            .default = `Normal Grazing Period End Date`)
  ) %>%
  dplyr::select(!`New Code`) %>%
  dplyr::filter(
    !(`County Name` %in% 
        c("Shoshone",
          # Remove duplicated "St. Louis, St. Louis City" records
          "St. Louis, St. Louis City")
    )
  ) %>%
  dplyr::distinct() %T>%
  readr::write_csv("fsa-normal-grazing-period.csv")

## The FSA county definitions 
fsa_counties <-
  sf::read_sf("https://climate-smart-usda.github.io/fsa-counties-dd17/fsa-counties-dd17.geojson") %>%
  dplyr::filter(!(`State Name` %in% 
                    c("American Samoa", 
                      "Northern Mariana Islands", 
                      "Guam",
                      "Virgin Islands of the U.S."))) %>%
  tigris::shift_geometry() %T>%
  geojsonio::topojson_write(file = "fsa_counties.topojson",
                            convert_wgs84 = FALSE,
                            overwrite = TRUE)

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

mean_yday_prep_start <-
  function(start, end){
    lubridate::year(start) <- ifelse(lubridate::month(start) > lubridate::month(end), 2000, 2001)
    
    return(start)
  }

mean_yday_prep_end <- 
  function(start, end){
    lubridate::year(end) <- 2001
    
    return(end)
  }

lfp_growing_seasons <-
  fsa_normal_grazing_period %>%
  dplyr::filter(!is.na(`Normal Grazing Period Start Date`)) %>%
  dplyr::select(`Program Year`, `FSA Code`, `Pasture Type`, `Normal Grazing Period Start Date`, `Normal Grazing Period End Date`) %>%
  dplyr::mutate(`Normal Grazing Period Start Date` = mean_yday_prep_start(`Normal Grazing Period Start Date`, `Normal Grazing Period End Date`),
                `Normal Grazing Period End Date` = mean_yday_prep_end(`Normal Grazing Period Start Date`, `Normal Grazing Period End Date`)
  ) %>%
  dplyr::arrange(`Pasture Type`) %>%
  dplyr::group_by(`Program Year`, `FSA Code`, `Pasture Type`) %>%
  dplyr::summarise(`Start Date` = lubridate::yday(mean(`Normal Grazing Period Start Date`, na.rm = TRUE)),
                   `End Date` = lubridate::yday(mean(`Normal Grazing Period End Date`, na.rm = TRUE))) %>%
  dplyr::group_by(`Program Year`, `Pasture Type`) %>%
  tidyr::nest() %>%
  dplyr::arrange(`Pasture Type`, `Program Year`) %>%
  dplyr::rowwise() %>%
  dplyr::mutate(
    graph = list(
      (
        
        dplyr::left_join(fsa_counties, data,
                         by = c("FSA Code" = "FSA Code")) %>%
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
          geom_sf(data = fsa_counties %>%
                    dplyr::group_by(`State Name`) %>%
                    dplyr::summarise(),
                  col = "white",
                  fill = NA,
                  linewidth = 0.5) +
          scale_fill_identity(na.value = "grey80") +
          ggplot2::labs(title = paste0(`Pasture Type`, " — ", `Program Year`),
                        subtitle = "Normal Grazing Period") +
          theme_void(base_size = 24) +
          theme(  plot.title = element_text(hjust = 0.5),
                  plot.subtitle = element_text(hjust = 0.5),
                  legend.position.inside = c(0.5,0.125),
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

unlink("fsa-normal-grazing-period.pdf")

cairo_pdf(filename = "fsa-normal-grazing-period.pdf",
          width = 16,
          height = 6.86,
          bg = "white",
          onefile = TRUE)

lfp_growing_seasons$graph

dev.off()


# # ISSUES
# known_issues <-fsa_normal_grazing_period %>%
#   dplyr::select(`Program Year`, 
#                 `FSA Code`,
#                 `Pasture Type`,
#                 `Normal Grazing Period Start Date`,
#                 `Normal Grazing Period End Date`) %>%
#   {
#     dplyr::left_join(
#       dplyr::select(., `Program Year`, 
#                     `FSA Code`,
#                     `Pasture Type`) %>%
#         {dplyr::filter(., duplicated(.))},
#       .
#     )
#   } %>%
#   dplyr::right_join(fsa_normal_grazing_period, .) %>%
#   dplyr::arrange(`Program Year`, 
#                  `FSA Code`,
#                  `Pasture Type`,
#                  `State Name`, `County Name`) %>%
#   distinct() %T>%
#   readr::write_csv("2025-FSA-04691-F Bocinsky.known_issues.csv")
