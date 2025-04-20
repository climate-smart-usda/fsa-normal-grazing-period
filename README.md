[![GitHub Release](https://img.shields.io/github/v/release/climate-smart-usda/fsa-normal-grazing-period?label=GitHub%20Release&color=%239c27b0)](https://github.com/climate-smart-usda/fsa-normal-grazing-period)
[![DOI](https://zenodo.org/badge/967595011.svg)](https://zenodo.org/badge/latestdoi/967595011)

# FSA Normal Grazing Period Archive

This repository is an archive of the annual county-level **Normal Grazing Period (NGP)** data for the USDA [Livestock Forage Disaster Program (LFP)](https://www.fsa.usda.gov/programs-and-services/disaster-assistance-program/livestock-forage/). Normal Grazing Periods define the historical timeframe during which forage is typically available for livestock grazing under non-drought conditions. These periods are used by the USDA Farm Service Agency (FSA) to determine eligibility and payment amounts for forage and crop loss due to drought.

> For more information on the role of NGPs in the LFP, refer to [FSA Handbook 1-DF, Rev. 1 Amendment 19](https://www.fsa.usda.gov/Internet/FSA_File/1-df_r01_a19.pdf), especially paragraphs 211–213.

The data in this repository were acquired via FOIA request **2025-FSA-04691-F** by R. Kyle Bocinsky (Montana Climate Office) and fulfilled on April 15, 2025. The FOIA response, including the original Excel workbook, is archived in the [`foia`](./foia) directory.

## 🗂️ Contents

- `foia/2025-FSA-04691-F Bocinsky.zip` — original FOIA data and correspondence
- `fsa-normal-grazing-period.csv` — cleaned and consolidated data
- `fsa-normal-grazing-period.R` — processing script
- `fsa-normal-grazing-period.qmd` — Quarto dashboard source
- `fsa-normal-grazing-period.html` — interactive summary dashboard

---

## 📥 Input Data: FOIA Excel Workbook

The FOIA response contains annual NGP data from **2008 through 2024** for each pasture type, county, and program year.

### Key Variables

| Variable Name                        | Description                                           |
|-------------------------------------|-------------------------------------------------------|
| `Program Year`                      | Year the data applies to                              |
| `State Name`                        | U.S. state                                            |
| `County Name`                       | County or county-equivalent name                      |
| `State FSA Code`                    | FSA-assigned state code (not always ANSI/FIPS)       |
| `County FSA Code`                   | FSA-assigned county code (not always ANSI/FIPS)      |
| `Pasture Grazing Type`             | Pasture classification (e.g., Native, Improved)       |
| `Normal Grazing Period Start Date` | Start date of typical grazing period                  |
| `Normal Grazing Period End Date`   | End date of typical grazing period                    |

---

## 🧹 Processing Workflow

The processing script [`fsa-normal-grazing-period.R`](./fsa-normal-grazing-period.R):

1. **Unzips and reads** the Excel workbook.
2. **Filters records** with missing dates.
3. **Constructs an `FSA Code`** by concatenating state and county FSA codes.
4. **Cleans and standardizes** pasture type names.
5. **Corrects known data errors**, including:
   - Erroneous years and dates in KS, UT, MS, and MT records.
   - Handling duplicate and misassigned counties (e.g., Shoshone County, ID).
6. **Removes invalid or duplicate entries**.
7. **Exports** the cleaned data to [`fsa-normal-grazing-period.csv`](./fsa-normal-grazing-period.csv).
8. **Renders** an interactive Quarto dashboard.

---

## 📤 Output Data: Cleaned CSV

The file [`fsa-normal-grazing-period.csv`](./fsa-normal-grazing-period.csv) is a tidy dataset for analysis and visualization.

### Variables in Output

| Variable Name                        | Description                                           |
|-------------------------------------|-------------------------------------------------------|
| `Program Year`                      | Year the data applies to                              |
| `State Name`                        | Full U.S. state name                                  |
| `County Name`                       | County or county-equivalent name                      |
| `State FSA Code`                    | FSA state code (not always ANSI/FIPS)                 |
| `County FSA Code`                   | FSA county code (not always ANSI/FIPS)                |
| `FSA Code`                          | Combined `State FSA Code` + `County FSA Code`         |
| `Pasture Type`                      | Standardized pasture type                             |
| `Normal Grazing Period Start Date` | Cleaned and corrected start date                      |
| `Normal Grazing Period End Date`   | Cleaned and corrected end date                        |

---

## 📊 Demonstration Dashboard

The Quarto dashboard [`fsa-normal-grazing-period.qmd`](./fsa-normal-grazing-period.qmd) provides:

- An **interactive viewer** to explore NGPs by county, year, and pasture type
- Visual summaries of **seasonality and regional variation**
- A **tool for researchers and policymakers** to assess temporal trends

<iframe src="fsa-normal-grazing-period.html" frameborder="0" allowfullscreen
  style="width:100%;height:40vw;"></iframe>
  
Access a full-screen version of the dashboard at:  
<https://climate-smart-usda.github.io/fsa-normal-grazing-period/fsa-normal-grazing-period.html>

---

## 🧭 About FSA County Codes

The USDA FSA uses custom county definitions that differ from standard ANSI/FIPS codes used by the U.S. Census. To align the Normal Grazing Period data with geographic boundaries, we use the FSA-specific geospatial dataset archived in the companion repository:

🔗 [**climate-smart-usda/fsa-counties-dd17**](https://climate-smart-usda.github.io/fsa-counties-dd17/)

FSA county codes are documented in [FSA Handbook 1-CM, Exhibit 101](https://www.fsa.usda.gov/Internet/FSA_File/1-cm_r03_a80.pdf).

---

## 📜 Citation

If using this data in published work, please cite:

> USDA Farm Service Agency. *Normal Grazing Periods, 2008–2024*. FOIA request 2025-FSA-04691-F. Accessed via GitHub archive, YYYY. https://github.com/climate-smart-usda/fsa-normal-grazing-period

---

## 📄 License

- **Raw FOIA data** (USDA): Public Domain (17 USC § 105)
- **Processed data & scripts**: © R. Kyle Bocinsky, released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/) and [MIT License](./LICENSE.md) as applicable

---

## ⚠️ Disclaimer

This dataset is archived for research and educational use only. It may not reflect current USDA administrative boundaries or official LFP policy. Always consult your **local FSA office** for the latest program guidance.

To locate your nearest USDA Farm Service Agency office, use the USDA Service Center Locator:

🔗 [**USDA Service Center Locator**](https://offices.sc.egov.usda.gov/locator/app)

---

## 👏 Acknowledgment

This project is part of:

**[*Enhancing Climate-smart Disaster Relief in FSA Programs*](https://www.ars.usda.gov/research/project/?accnNo=444612)**  
Supported by USDA OCE/OEEP and USDA Climate Hubs  
Prepared by the [Montana Climate Office](https://climate.umt.edu)

---

## ✉️ Contact

Questions? Contact Kyle Bocinsky: [kyle.bocinsky@umontana.edu](mailto:kyle.bocinsky@umontana.edu)
