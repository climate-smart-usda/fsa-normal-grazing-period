# fsa-normal-grazing-period
Official county-level normal grazing period definitions from the USDA Farm Service Agency

There is also currently (as of 2025-04-15) [a dashboard displaying 2024 and 2025 Normal Grazing Periods](https://experience.arcgis.com/experience/fead3dd0e6e34468ba82ca5cb7bd2340/). This dashboard is referenced in [Notice LFP-3](https://www.fsa.usda.gov/Internet/FSA_Notice/lfp_3.pdf), though the data should not be considered authoritative. A download of the data displayed in the dashboard is available as under <data-raw>.



# Annual Normal Grazing Period data from the Livestock Forage Disaster Program, 2008–2024

This repository is an archive of the annual county-level normal grazing period data for the [Livestock Forage Disaster Program](https://www.fsa.usda.gov/programs-and-services/disaster-assistance-program/livestock-forage/index). These data were acquired via Freedom of Information Act (FOIA) request 2025-FSA-04691-F made by R. Kyle Bocinsky, Director of Climate Extension for the [Montana Climate Office](https://climate.umt.edu), to the US Department of Agriculture (USDA) [Farm Production and Conservation Business Center (FPAC-BC)](https://www.fpacbc.usda.gov). The request was submitted on February 14, 2025, and was fulfilled on April 15, 2025.

The original FOIA request, copies of all email communications with the USDA Farm Production and Conservation Business Center (FPAC-BC), and data as received are in the [`foia`](/foia) directory and [`foia/2025-FSA-04691-F Bocinsky.zip`](/foia/2025-FSA-04691-F%20Bocinsky.zip) zip archive.

Data were ingested into the [R statistical framework](https://www.r-project.org), were cleaned to a common set of fields and filtered to only include counties in the contiguous United States, and then were written to a consolidated CSV file ([`fsa-normal-grazing-period.csv`](/fsa-normal-grazing-period.csv)) and mapped in multi-page PDF ([`fsa-normal-grazing-period.pdf`](/fsa-normal-grazing-period.pdf)). [`fsa-normal-grazing-period.R`](/fsa-normal-grazing-period.R) is the R script that cleans the data and produces the maps.

The FSA uses slightly different county or county equivalent definitions for their service areas than the standard ANSI FIPS areas used by the US Census. The FSA counties are included in the [`fsa-counties`](/fsa-counties) directory; FSA county codes are detailed in [FSA Handbook 1-CM](https://www.fsa.usda.gov/Internet/FSA_File/1-cm_r03_a80.pdf), Exhibit 101.

Data in the [`foia/2025-FSA-04691-F Bocinsky.zip`](/foia/2025-FSA-04691-F%20Bocinsky.zip) archive were produced by the USDA Farm Service Agency and are in the Public Domain. All other data, including the processed data and maps were created by R. Kyle Bocinsky and are released under the [Creative Commons CCZero license](https://creativecommons.org/publicdomain/zero/1.0/). The [`fsa-lfp-eligibility.R`](/fsa-lfp-eligibility.R) script is copyright R. Kyle Bocinsky, and is released under the [MIT License](/LICENSE.md).

This work was supported by a grant from the National Oceanic and Atmospheric Administration, [National Integrated Drought Information System](https://www.drought.gov) (University Corporation for Atmospheric Research subaward SUBAWD000858). We also acknowledge and appreciate the prompt and professional FOIA response we received from the USDA FPAC-BC.

Please contact Kyle Bocinsky ([kyle.bocinsky@umontana.edu](mailto:kyle.bocinsky@umontana.edu)) with any questions.

<br>
<p align="center">
<a href="https://climate.umt.edu" target="_blank">
<img src="https://climate.umt.edu/assets/images/MCO_logo_icon_only.png" width="350" alt="The Montana Climate Office logo.">
</a>
</p>
