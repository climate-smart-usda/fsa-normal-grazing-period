library(tidyverse)
library(magrittr)
library(quarto)

# FSA-defined Normal Grazing Periods
fsa_normal_grazing_period <-
  unzip(zipfile = "foia/2025-FSA-04691-F Bocinsky.zip",
        files = "LFP_NormalGrazingPeriodsReport20250416.xlsx",
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

## Render the interactive dashboard
quarto::quarto_render("fsa-normal-grazing-period.qmd")
