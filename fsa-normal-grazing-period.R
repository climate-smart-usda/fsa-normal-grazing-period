library(tidyverse)
library(magrittr)
library(quarto)

source("R/s3-archive.R")
s3_preflight()

s3_bucket <- Sys.getenv("S3_BUCKET", unset = "sustainable-fsa")
s3_prefix <- Sys.getenv("S3_PREFIX", unset = "fsa-normal-grazing-period")

# FSA's published county definitions, to check every FSA county in the report is a
# real one. Reads the code columns only, so the geometry is not transferred.
fsa_counties <-
  arrow::read_parquet(
    "https://data.sustainable-fsa.com/fsa-counties-dd22/fsa-counties-dd22.parquet",
    col_select = c("FSA_ST", "FSA_STCOU")
  ) %>%
  dplyr::transmute(
    `State FSA Code` = FSA_ST,
    `County FSA Code` = stringr::str_trunc(FSA_STCOU, 3, side = "left", ellipsis = "")
  ) %>%
  dplyr::distinct()

# Extract a single member from a zip archive as a file path. R's internal
# unzip (the default method) intermittently throws "error 1 in extracting
# from zip file" on these FOIA archives even though the archive is valid;
# fall back to the system unzip binary, which handles them without issue.
extract_member <- function(zipfile, file, exdir = tempdir()) {
  path <- file.path(exdir, file)
  extracted <- tryCatch(
    unzip(zipfile = zipfile, files = file, exdir = exdir),
    warning = function(w) character(0)
  )
  if (length(extracted) == 0 || !file.exists(path)) {
    unzip(zipfile = zipfile, files = file, exdir = exdir, unzip = "unzip")
  }
  if (!file.exists(path)) {
    stop("Failed to extract '", file, "' from '", zipfile, "'")
  }
  path
}

# FSA-defined Normal Grazing Periods, keyed on (Program Year, State FSA Code,
# County FSA Code, Pasture Type) — the grain FSA reports at. No aggregation.
fsa_normal_grazing_period <-
  extract_member("foia/2025-FSA-04691-F Bocinsky.zip",
                 "LFP_NormalGrazingPeriodsReport20250416.xlsx") %>%
  readxl::read_excel() %>%
  dplyr::bind_rows(.,
    extract_member("foia/2026-FSA-03465-F Bocinsky.zip",
                    "2026-FSA-03465-F Bocinsky/LFP_NormalGrazingPeriodsReport20260422.xlsx") |>
      readxl::read_excel() |>
      dplyr::mutate(
        state_fsa_code = stringr::str_pad(state_fsa_code, width = 2, pad = "0"),
        county_fsa_code = stringr::str_pad(county_fsa_code, width = 3, pad = "0")
      ) |>
      magrittr::set_names(x = _, value = names(.))
  ) %>%
  # Some start and end dates are NA — remove
  dplyr::filter(!is.na(`Normal Grazing Period Start Date`)) %>%
  dplyr::transmute(
    `Program Year`,
    `State FSA Code`,
    `County FSA Code`,
    `FSA State Name` = `State Name`,
    `FSA County Name` = `County Name`,
    `Pasture Type` = `Pasture Grazing Type`,
    `Grazing Period Start Date` =  lubridate::as_date(`Normal Grazing Period Start Date`),
    `Grazing Period End Date` = lubridate::as_date(`Normal Grazing Period End Date`)
  )

# FSA reports Missouri 29510 as both "St. Louis" and "St. Louis, St. Louis City"
# with identical dates. Recorded for the QA report, then canonicalized below.
qa_name_variants <-
  fsa_normal_grazing_period %>%
  dplyr::distinct(`State FSA Code`, `County FSA Code`,
                  `FSA State Name`, `FSA County Name`) %>%
  dplyr::filter(dplyr::n() > 1L,
                .by = c(`State FSA Code`, `County FSA Code`)) %>%
  dplyr::arrange(`State FSA Code`, `County FSA Code`, `FSA County Name`)

fsa_normal_grazing_period <-
  fsa_normal_grazing_period %>%
  # One name per FSA county, alphabetically first.
  dplyr::mutate(
    `FSA State Name` = min(`FSA State Name`),
    `FSA County Name` = min(`FSA County Name`),
    .by = c(`State FSA Code`, `County FSA Code`)
  ) %>%
  dplyr::mutate(

    # Correct name of "Full Season Improved Mixed Pasture" in certain records
    `Pasture Type` = 
      dplyr::replace_values(
        `Pasture Type`,
        "Full Season Improved Mixed Pastures" ~ 
          "Full Season Improved Mixed Pasture"),
    
    # Corrections to erroneous dates in the FOIA source. Each arm must be scoped
    # to the pasture type(s) it names: scoping to program year and state alone
    # inverts the winter forage types, which begin in the prior calendar year.
    `Grazing Period Start Date` =
      case_when(
        # Native Pasture in Piute and Sevier, UT starts a year early
        # (2009-04-01 → 2010-12-01). Surrounding counties begin 2010-04-01.
        `Program Year` == 2010 &
          `State FSA Code` == "49" &
          `County FSA Code` %in% c("031", "041") &
          `Pasture Type` == "Native Pasture" ~
          lubridate::as_date("2010-04-01"),

        # Three 2026 South Dakota records give the start year as 2006, with the
        # end date in 2026. Replacements are the modal value among the other
        # South Dakota counties for the same pasture type and program year.
        `Program Year` == 2026 &
          `State FSA Code` == "46" &
          `County FSA Code` == "003" &
          `Pasture Type` == "Annual Ryegrass" ~
          lubridate::as_date("2026-07-01"),

        `Program Year` == 2026 &
          `State FSA Code` == "46" &
          `County FSA Code` == "045" &
          `Pasture Type` == "Long Season Small Grains" ~
          lubridate::as_date("2026-07-15"),

        `Program Year` == 2026 &
          `State FSA Code` == "46" &
          `County FSA Code` == "077" &
          `Pasture Type` == "Full Season Improved Mixed Pasture" ~
          lubridate::as_date("2026-07-15"),

        # Mississippi Annual Ryegrass is a year early in 2013 only
        # (2011-12-01 → 2012-05-31). Other years run 01 December of the prior
        # year into the program year.
        `Program Year` == 2013 &
          `State FSA Code` == "28" &
          `Pasture Type` == "Annual Ryegrass" ~
          lubridate::as_date("2012-12-01"),

        .default = `Grazing Period Start Date`
      ),

    `Grazing Period End Date` =
      case_when(
        # Paired with the Mississippi Annual Ryegrass start-date correction above.
        `Program Year` == 2013 &
          `State FSA Code` == "28" &
          `Pasture Type` == "Annual Ryegrass" ~
          lubridate::as_date("2013-05-31"),

        # Six West Virginia counties give a 2027 end year against a 2026 program
        # year and a 2026-04-15 start. Only the year is corrected: FSA moved the
        # end date from 10-31 in 2025 to 11-15, so 11-15 stands.
        `Program Year` == 2026 &
          `State FSA Code` == "54" &
          `County FSA Code` %in% c("031", "071", "075", "077", "083", "093") &
          `Pasture Type` %in% c("Native Pasture", "Full Season Improved Pasture") ~
          lubridate::as_date("2026-11-15"),

        .default = `Grazing Period End Date`
      )
  ) %>%
  dplyr::filter(!is.na(`Pasture Type`)) %>%
  # Removes 371 exact repeats: 7 identical in the source, the rest identical once
  # the pasture-type spelling and the 29510 name were standardized above.
  dplyr::distinct() %>%
  dplyr::arrange(`Program Year`, `State FSA Code`, `County FSA Code`,
                 `Pasture Type`)


## ---------------------------------------------------------------------------
## Validation
##
## Invariants abort before write_csv(), so a bad archive reaches neither git nor
## S3. Outliers are reported instead: they occur in the source, and a new FOIA
## release can introduce one without blocking publication.
## ---------------------------------------------------------------------------

# Fail with the count and a sample, so a CI log alone identifies the cause.
assert_empty <- function(offenders, what) {
  if (nrow(offenders) == 0L) {
    return(invisible(NULL))
  }
  stop("Validation failed — ", what, ": ", nrow(offenders), " record(s).\n",
       paste(
         utils::capture.output(print(utils::head(offenders, 10L), width = 200)),
         collapse = "\n"
       ),
       call. = FALSE)
}

assert_empty(
  fsa_normal_grazing_period %>%
    dplyr::count(`Program Year`, `State FSA Code`, `County FSA Code`,
                 `Pasture Type`) %>%
    dplyr::filter(n > 1L),
  "duplicate (Program Year, FSA county, Pasture Type) keys"
)

# An FSA code the report names but FSA's definitions do not is unmappable and
# unjoinable. The only external list the script fetches beyond the FOIA workbooks.
assert_empty(
  fsa_normal_grazing_period %>%
    dplyr::distinct(`State FSA Code`, `County FSA Code`, `FSA State Name`,
                    `FSA County Name`) %>%
    dplyr::anti_join(fsa_counties,
                     by = c("State FSA Code", "County FSA Code")),
  "FSA counties in the archive absent from FSA's published county definitions"
)

assert_empty(
  fsa_normal_grazing_period %>%
    dplyr::filter(`Grazing Period End Date` < `Grazing Period Start Date`),
  "grazing periods whose end date precedes its start date"
)

assert_empty(
  fsa_normal_grazing_period %>%
    dplyr::filter(dplyr::if_any(dplyr::everything(), is.na)),
  "records with a missing value"
)

# Grazing periods may begin in the calendar year before the program year, and a
# few end in the year after, so the tolerated window is [PY - 1, PY + 1].
qa_window <-
  fsa_normal_grazing_period %>%
  dplyr::filter(
    !dplyr::between(lubridate::year(`Grazing Period Start Date`),
                    `Program Year` - 1, `Program Year` + 1) |
      !dplyr::between(lubridate::year(`Grazing Period End Date`),
                      `Program Year` - 1, `Program Year` + 1)
  )

qa_zero_length <-
  fsa_normal_grazing_period %>%
  dplyr::filter(`Grazing Period End Date` == `Grazing Period Start Date`)

# A grazing period cannot exceed a year. The window check tolerates an end date in
# the following year, which winter periods need, so a wrong end year can pass it.
qa_duration <-
  fsa_normal_grazing_period %>%
  dplyr::filter(as.integer(`Grazing Period End Date` -
                             `Grazing Period Start Date`) > 366L)

# Years unreported within a county's own span of reporting years. Ten counties, 15
# county-years, mostly 2009–2011: five Arkansas counties, all three Delaware
# counties, Charlotte VA, and Shoshone ID in 2016.
qa_missing_county_years <-
  fsa_normal_grazing_period %>%
  dplyr::distinct(`State FSA Code`, `County FSA Code`, `FSA State Name`,
                  `FSA County Name`, `Program Year`) %>%
  dplyr::reframe(
    `Missing Year` = setdiff(seq(min(`Program Year`), max(`Program Year`)),
                             `Program Year`),
    .by = c(`State FSA Code`, `County FSA Code`, `FSA State Name`,
            `FSA County Name`)
  ) %>%
  dplyr::arrange(`State FSA Code`, `County FSA Code`, `Missing Year`)

# Detail tables as indented CSV; a tibble's print wraps wide frames across
# several blocks.
qa_detail <- function(x) {
  if (nrow(x) == 0L) {
    return(character(0))
  }
  paste0("  ", strsplit(readr::format_csv(x), "\n", fixed = TRUE)[[1]])
}

qa_report <- c(
  "FSA Normal Grazing Period archive — QA report",
  "",
  "Grain: one record per program year, FSA county, and pasture type — the grain",
  "FSA reports at. No aggregation is applied. For Census geography, join the",
  "fsa-counties-dd17 or fsa-counties-dd22 archive, choosing the vintage that",
  "matches the program year.",
  "",
  paste0("Records published: ", nrow(fsa_normal_grazing_period)),
  paste0("FSA counties: ", dplyr::n_distinct(fsa_normal_grazing_period$`State FSA Code`,
                                             fsa_normal_grazing_period$`County FSA Code`)),
  paste0("Program years: ", paste(range(fsa_normal_grazing_period$`Program Year`),
                                  collapse = "-")),
  paste0("Pasture types: ", dplyr::n_distinct(fsa_normal_grazing_period$`Pasture Type`)),
  "",
  "Invariants enforced (the run aborts on any violation):",
  "  * exactly one record per (program year, FSA county, pasture type)",
  "  * grazing period end date on or after its start date",
  "  * no missing values in any published field",
  "  * every FSA county resolves against FSA's published county definitions",
  "",
  paste0("Dates outside [program year - 1, program year + 1]: ", nrow(qa_window)),
  qa_detail(qa_window),
  "",
  paste0("Zero-length grazing periods: ", nrow(qa_zero_length)),
  qa_detail(qa_zero_length),
  "",
  paste0("Grazing periods longer than 366 days: ", nrow(qa_duration)),
  qa_detail(qa_duration),
  "",
  paste0("County-years absent between two reporting years: ",
         nrow(qa_missing_county_years)),
  "  FSA published no grazing period for these; they are blank on the map.",
  qa_detail(qa_missing_county_years),
  "",
  paste0("FSA counties reported under more than one name: ",
         dplyr::n_distinct(qa_name_variants$`State FSA Code`,
                           qa_name_variants$`County FSA Code`)),
  "  Collapsed to the alphabetically first name so the key stays unique.",
  qa_detail(qa_name_variants),
  ""
)

writeLines(qa_report, "qa-report.txt")

if (nrow(qa_window) + nrow(qa_zero_length) + nrow(qa_duration) +
    nrow(qa_missing_county_years) > 0L) {
  warning("QA outliers present: ", nrow(qa_window), " out-of-window date(s), ",
          nrow(qa_zero_length), " zero-length period(s), ",
          nrow(qa_duration), " over-long period(s), ",
          nrow(qa_missing_county_years), " missing county-year(s). ",
          "See qa-report.txt.",
          call. = FALSE)
}

# Mirrored CSV and Parquet, identical records. CSV carries no types, so codes like
# "01" read back as 1; Parquet keeps them character and dates as dates.
readr::write_csv(fsa_normal_grazing_period, "fsa-normal-grazing-period.csv")
arrow::write_parquet(fsa_normal_grazing_period,
                     sink = "fsa-normal-grazing-period.parquet",
                     version = "latest",
                     compression = "zstd",
                     compression_level = 13,
                     use_dictionary = TRUE)

## Render the interactive dashboard
quarto::quarto_render("fsa-normal-grazing-period.qmd")

## Render the README
quarto::quarto_render("README.Rmd", output_format = "md")

## Publish the archive to S3 (dual-write alongside the git mirror)
s3_put(bucket = s3_bucket,
       key = paste0(s3_prefix, "/fsa-normal-grazing-period.csv"),
       file = "fsa-normal-grazing-period.csv",
       content_type = "text/csv")

s3_put(bucket = s3_bucket,
       key = paste0(s3_prefix, "/fsa-normal-grazing-period.parquet"),
       file = "fsa-normal-grazing-period.parquet",
       content_type = "application/vnd.apache.parquet")

s3_put(bucket = s3_bucket,
       key = paste0(s3_prefix, "/qa-report.txt"),
       file = "qa-report.txt",
       content_type = "text/plain")

s3_push(bucket = s3_bucket,
        prefix = paste0(s3_prefix, "/assets"),
        local_dir = "assets",
        delete = TRUE)

s3_push(bucket = s3_bucket,
        prefix = paste0(s3_prefix, "/foia"),
        local_dir = "foia",
        delete = TRUE)

s3_write_manifest(bucket = s3_bucket,
                  prefix = s3_prefix)

cf_invalidate(
  paths = c(
    paste0("/", s3_prefix, "/fsa-normal-grazing-period.csv"),
    paste0("/", s3_prefix, "/fsa-normal-grazing-period.parquet"),
    paste0("/", s3_prefix, "/qa-report.txt"),
    paste0("/", s3_prefix, "/_manifest.txt")
  )
)
