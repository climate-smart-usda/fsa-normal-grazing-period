## What this map shows

**Normal Grazing Periods (NGPs)** define the historical timeframe during which forage is typically available for livestock grazing under non-drought conditions. The USDA Farm Service Agency (FSA) uses them to determine eligibility and payment amounts under the [Livestock Forage Disaster Program (LFP)](https://www.fsa.usda.gov/resources/programs/livestock-forage-disaster-program-lfp): a county qualifies only when drought occurs *during* its normal grazing period for a given pasture type, and the period's length caps the payment. This map draws every period FSA reported from **2008 through 2026** — 244,890 records across 3,095 FSA counties and 16 pasture types — one county polygon per FSA service area, exactly as FSA reports it. For the program rules themselves, see [FSA Handbook 1-LFP, Amendment 4](https://www.fsa.usda.gov/Internet/FSA_File/1lfp_a4.pdf).

## Using the map

**Choose what you see.** The **year** slider steps through program years 2008–2026. The **pasture type** menu selects one of the 16 forage classifications FSA reports (Native Pasture, Improved Pasture, Long Season Small Grains, and so on). **Color by** switches the variable painted on the counties: *Season Start*, *Season End*, or *Duration*.

**Read the legend.** Season Start and Season End are days of the year, so they use a **cyclic month wheel**: a county's color is the position of its date around the calendar, read against the month labels on the ring. The palette wraps, so late December and early January are neighboring hues rather than opposite ends of a scale — which is what you want for dates, since a period beginning December 28 is not a world away from one beginning January 3. Winter forage types routinely start in the calendar year *before* their program year; those dates take their place on the wheel like any other. Duration is not cyclic, so it uses a plain **linear color bar**, dark to light, running 0 to 52 weeks.

**Look up a county.** Click any county, or type a name in the search box, to open its detail card. The card is not limited to the year on the slider: it charts the county's grazing-period spans for the selected pasture type across all years 2008–2026, so you can see at a glance where the period has shifted, lengthened, or gone unreported, with the underlying dates in a table below.

**Change the theme.** The navbar toggle switches between the light theme and a high-contrast theme that strengthens outlines and text contrast.

**Share what you are looking at.** The address bar always reflects the current view — year, pasture type, color-by variable, and selected county — so copying it or bookmarking it reproduces exactly what is on your screen. The **Share** button copies that link for you.

**Save an image.** The **PNG export** button downloads the current map as a branded image, legend and all, suitable for a slide or a report.

**Keyboard.**

| Key | Action |
|-----|--------|
| `Tab` / `Shift`+`Tab` | Move between controls |
| `Arrow` keys | Adjust the focused slider or menu |
| `Enter` / `Space` | Activate the focused control |
| `/` | Jump to the county search box |
| `Esc` | Close the open card, menu, or dialog |

Single-key shortcuts (`/`) can be turned off by adding `?kbd=off` to the map's URL — useful with speech input or other assistive tools that send keystrokes.

## What a blank county means

An uncolored county means one of two distinct things.

**No polygon.** The island territories are not drawn, because neither FSA boundary archive includes them. Their grazing periods are still in the data and in the downloadable files — they simply have no shape to paint.

**No reported grazing period** for that county, year, and pasture type. FSA did not publish a period for every county in every year. Ten FSA counties have a year missing inside their own span of reporting — 15 county-years in all, mostly 2009–2011, plus Shoshone County, ID in 2016. Every one is listed in [`qa-report.txt`](https://data.sustainable-fsa.com/fsa-normal-grazing-period/qa-report.txt).

**Which boundaries a year is drawn on.** County boundaries are fetched at run time from the FSA administrative boundary archives, and **the vintage follows the program year**: [`fsa-counties-dd17`](https://data.sustainable-fsa.com/fsa-counties-dd17/) for 2008–2014 and [`fsa-counties-dd22`](https://data.sustainable-fsa.com/fsa-counties-dd22/) for 2015 onward. FSA re-drew eight county footprints between the two handbook digests — Shoshone County, ID was split out of the Benewah and Kootenai offices; Sioux County, NE was consolidated into `31165`; King County, WA into `53033`; and Richmond City, VA was split out of Henrico. Each year is therefore drawn on the boundaries that were in force for it, and the two vintages are never mixed within a year. Drawing an early year on current boundaries would leave the territory of a since-split county blank even though its grazing period was reported, under the office that then administered it.

## About the data

The data are USDA FSA's own, obtained under the Freedom of Information Act by R. Kyle Bocinsky (Montana Climate Office, University of Montana) in three requests: **2025-FSA-04691-F**, **2026-FSA-02435-F**, and **2026-FSA-03465-F**. All three requests and their responses are archived with the data. The published archive is built from two of them — 2025-FSA-04691-F (program years 2008–2025) and 2026-FSA-03465-F (2025–2026); 2026-FSA-02435-F is retained for provenance but contributes no county, program year, or pasture type the other two lack.

**What was changed.** Rows with no start or end date were dropped (about 33,000; no row had one date without the other). Pasture type names and FSA county names were standardized where FSA reported one thing under two spellings, and 371 rows that were then exact repeats were removed — no record differing in its dates is ever merged with another. Four known errors in the source were corrected, each scoped to the county, program year, and pasture type it applies to: start years reported one year early for Native Pasture in Piute and Sevier counties, UT (2010) and for Mississippi Annual Ryegrass (2013); a start year of 2006 in three South Dakota counties (2026); and an end year of 2027 in six West Virginia counties (2026), which described a 19-month period. **What was checked.** The build aborts unless every record is unique by program year, county, and pasture type; every period ends on or after it starts; no published field is missing; and every FSA county resolves against FSA's published county definitions. Softer flags — zero-length periods, gaps in a county's reporting, counties reported under two names — are published rather than silently fixed, in [`qa-report.txt`](https://data.sustainable-fsa.com/fsa-normal-grazing-period/qa-report.txt).

**Get the data.** The archive of record is published as [CSV](https://data.sustainable-fsa.com/fsa-normal-grazing-period/fsa-normal-grazing-period.csv) and [Parquet](https://data.sustainable-fsa.com/fsa-normal-grazing-period/fsa-normal-grazing-period.parquet) with identical records, one row per program year, FSA county, and pasture type. Processing code, FOIA correspondence, and this map's source are in the [GitHub repository](https://github.com/sustainable-fsa/fsa-normal-grazing-period).

**FSA county codes are not FIPS codes.** They coincide for most counties, but FSA administers some Census counties as two or three separate service areas and elsewhere administers many Census counties from one — so 20 of the 3,095 FSA counties here carry a code matching no FIPS county they cover. To reach Census geography, take the crosswalk from the boundary archives, which are the authority on it: [fsa-counties-dd17](https://data.sustainable-fsa.com/fsa-counties-dd17/) for program years 2008–2014, [fsa-counties-dd22](https://data.sustainable-fsa.com/fsa-counties-dd22/) for 2015 onward.

## Citation

If you use this data in published work, please cite:

> USDA Farm Service Agency. *Normal Grazing Periods, 2008–2026*. Obtained under FOIA requests 2025-FSA-04691-F, 2026-FSA-02435-F, and 2026-FSA-03465-F; curated and archived by R. Kyle Bocinsky, Montana Climate Office, University of Montana. Sustainable FSA project. Accessed YYYY-MM-DD. <https://sustainable-fsa.com/fsa-normal-grazing-period/>
>
> DOI: <https://doi.org/10.5281/zenodo.15252842>

## License

- **Raw FOIA data** (USDA): Public Domain (17 U.S.C. § 105)
- **Processed data**: released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/)
- **Code**, including this map: © R. Kyle Bocinsky, released under the [MIT License](https://github.com/sustainable-fsa/fsa-normal-grazing-period/blob/main/LICENSE)

## Disclaimer

This dataset is archived for research and educational use only. It may not reflect current USDA administrative boundaries or official LFP policy. Always consult your **local FSA office** for the latest program guidance. To find yours, use the [USDA Service Center Locator](https://offices.sc.egov.usda.gov/locator/app).

## Acknowledgments & contact

This work is part of the [*Enhancing Sustainable Disaster Relief in FSA Programs*](https://www.ars.usda.gov/research/project/?accnNo=444612) project, supported by the USDA Office of the Chief Economist, Office of Energy and Environmental Policy, and the USDA Climate Hubs. It was prepared by the [Montana Climate Office](https://climate.umt.edu), W.A. Franke College of Forestry & Conservation, University of Montana.

Questions, corrections, and requests: [kyle.bocinsky@umontana.edu](mailto:kyle.bocinsky@umontana.edu).
