## ---------------------------------------------------------------------------
## Browser assets for the web map.
##
## Two producers, both pure functions of the validated archive (or of nothing at
## all), so they can be sourced and exercised on their own — no AWS credentials,
## no S3 client, no FOIA workbooks:
##
##   build_web_data()   the column-oriented JSON the map reads
##   build_color_ramps() the two color ramps the map colors with
##
## Everything is namespace-qualified; sourcing this file attaches no packages.
## ---------------------------------------------------------------------------


## The whole archive as one browser-sized file.
##
## Structure-of-arrays, not an array of row objects: the field names are paid for
## once instead of 244,890 times, and the strings (pasture type, FSA county, county
## and state name) collapse to small integer indices into shared dictionaries. Dates
## are stored as a day-of-year plus a year offset from the program year rather than
## as ISO strings — grazing periods routinely begin in the calendar year before the
## program year and a few end in the year after, so the offset is what makes the day
## number unambiguous. The browser rebuilds the date as
## `Date.UTC(year0 + year + so, 0, sy)`.
##
## Rows are sorted by (pasture type, FSA county, program year). The sort is not
## cosmetic: it puts each county's run of years adjacent, so the parallel arrays
## become long stretches of near-constant values and gzip takes the file to roughly
## 100 KB (measured 97.9 KB at gzip -9).
##
## The schema is a frozen contract — the front end indexes these arrays by name and
## position. Add fields; do not rename or reorder the existing ones without bumping
## `schema`.
build_web_data <- function(ngp, path = "assets/fsa-normal-grazing-period-web.json") {

  web <-
    ngp |>
    dplyr::transmute(
      type = `Pasture Type`,
      county = paste0(`State FSA Code`, `County FSA Code`),
      county_name = `FSA County Name`,
      state_name = `FSA State Name`,
      year = as.integer(`Program Year`),
      start = `Grazing Period Start Date`,
      end = `Grazing Period End Date`,
      sy = as.integer(lubridate::yday(start)),
      so = as.integer(lubridate::year(start)) - year,
      ey = as.integer(lubridate::yday(end)),
      eo = as.integer(lubridate::year(end)) - year
    ) |>
    # C-locale ordering (dplyr's default), which is what the dictionary sorts below
    # use as well, so the emitted index arrays come out non-decreasing.
    dplyr::arrange(type, county, year)

  # Hard invariant: (program year + offset, day-of-year) must reconstruct every
  # date exactly. A lossy encoding here would be invisible in the browser, so it
  # aborts the run instead.
  stopifnot(
    identical(
      lubridate::make_date(web$year + web$so, 1L, 1L) + web$sy - 1L,
      web$start
    ),
    identical(
      lubridate::make_date(web$year + web$eo, 1L, 1L) + web$ey - 1L,
      web$end
    )
  )

  # Dictionaries. `method = "radix"` sorts in the C locale, so the file is
  # byte-identical whatever locale the runner happens to be in.
  types <- sort(unique(web$type), method = "radix")
  counties <- sort(unique(web$county), method = "radix")

  # One county and state name per FSA county — the archive canonicalizes these
  # upstream, so a duplicate here means that step regressed.
  county_names <- dplyr::distinct(web, county, county_name, state_name)
  stopifnot(
    !anyDuplicated(county_names$county),
    nrow(county_names) == length(counties)
  )
  county_names <- county_names[match(counties, county_names$county), ]

  year0 <- min(web$year)

  payload <- list(
    schema = jsonlite::unbox("fsa-ngp-web/1"),
    generated = jsonlite::unbox(format(Sys.Date(), "%Y-%m-%d")),
    license = jsonlite::unbox("CC0-1.0"),
    year0 = jsonlite::unbox(year0),
    years = range(web$year),
    types = types,
    counties = counties,
    county_names = county_names$county_name,
    state_names = county_names$state_name,
    n = jsonlite::unbox(nrow(web)),
    type = match(web$type, types) - 1L,
    county = match(web$county, counties) - 1L,
    year = web$year - year0,
    sy = web$sy,
    so = web$so,
    ey = web$ey,
    eo = web$eo
  )

  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  jsonlite::write_json(payload, path, auto_unbox = FALSE, digits = NA)

  invisible(path)
}


## The two color ramps the map colors with, as JSON arrays of hex strings.
##
## Both are scientific (perceptually uniform) palettes from Crameri's collection:
##
##   colors.json          romaO, cyclic, 366 entries in day-of-year order. Rotated
##                        so the seam falls at 01 July rather than 01 January —
##                        grazing seasons straddle the new year, and a discontinuity
##                        mid-season would read as a real break in the data.
##   colors-duration.json batlowK, sequential, 53 entries for 0-52 weeks. Matches the
##                        duration map in README.Rmd.
##
## Ported unchanged from the retired dashboard; the ramps are a published contract
## and must stay byte-for-byte what they were.
build_color_ramps <- function(dir = "assets") {

  dir.create(dir, recursive = TRUE, showWarnings = FALSE)

  ## yday cyclic palette
  dates <- seq(lubridate::as_date("1999-07-01"), lubridate::as_date("2000-06-30"), "1 day")
  color_shift <- 250
  colors <- as.character(khroma::color("romaO", reverse = TRUE)(366))
  colors <- colors[c((color_shift + 1):366, 1:color_shift)]

  yday_pal <-
    tibble::tibble(date = dates,
                   color = colors,
                   yday = lubridate::yday(dates)) |>
    dplyr::arrange(yday)

  jsonlite::write_json(yday_pal$color, file.path(dir, "colors.json"), auto_unbox = TRUE)

  ## duration sequential palette (weeks), matching README.Rmd's static map
  duration_max <- 52
  duration_colors <- as.character(khroma::color("batlowK")(duration_max + 1))
  jsonlite::write_json(duration_colors, file.path(dir, "colors-duration.json"),
                       auto_unbox = TRUE)

  invisible(file.path(dir, c("colors.json", "colors-duration.json")))
}
