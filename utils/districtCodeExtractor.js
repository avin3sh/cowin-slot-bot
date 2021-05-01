const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const DIST_LOWER_LIMIT = 1;
const DIST_UPPER_LIMIT = 37;

const main = async () => {
  const districtData = {};
  let success = true;
  for (let i = DIST_LOWER_LIMIT; i <= DIST_UPPER_LIMIT; i++) {
    console.info('Fetching districts for state ID', i);
    const apiEndpoint = `https://cdn-api.co-vin.in/api/v2/admin/location/districts/${i}`;

    try {
      let data = await fetch(apiEndpoint, {
        method: 'GET',
      });
      data = await data.json();

      if (!data || !data.districts || !Array.isArray(data.districts)) {
        console.error('Unexpected response structure - districts key is inappropriate', JSON.stringify(data));
        success = false;
        break;
      }

      data.districts.forEach((district) => {
        if (typeof district.district_id === 'undefined' || !district.district_name) {
          console.error('District ID or District Name missing ', district);
          success = false;
          return;
        }

        districtData[district.district_id] = {
          id: district.district_id,
          name: district.district_name,
        };
      });
    } catch (e) {
      console.error(`Unable to fetch district details for state ID ${i} `, err);
      success = false;
      break;
    }
  }

  if (success) {
    fs.writeFileSync(path.join(__dirname, '..', 'assets', 'districts.json'), JSON.stringify(districtData), (err) => {
      if (err) {
        console.error('Error writing msg to the file: ', err);
      }
      //file written successfully
      console.info('Wrote all district data to districts.json asset file');
    });
  }
};

main();
