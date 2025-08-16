const fs = require('fs');
const path = require('path');

// Default values for missing address components
const DEFAULT_VALUES = {
  state: '',
  country: 'United States',
  zipCode: '',
  city: ''
};

// Common state abbreviations and full names
const STATE_MAPPING = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming'
};

// Common country names and abbreviations
const COUNTRY_MAPPING = {
  'USA': 'United States', 'US': 'United States', 'United States of America': 'United States',
  'Canada': 'Canada', 'CA': 'Canada',
  'UK': 'United Kingdom', 'United Kingdom': 'United Kingdom', 'England': 'United Kingdom',
  'Australia': 'Australia', 'AU': 'Australia',
  'France': 'France', 'FR': 'France',
  'Germany': 'Germany', 'DE': 'Germany',
  'Italy': 'Italy', 'IT': 'Italy',
  'Spain': 'Spain', 'ES': 'Spain'
};

// Common street suffixes
const STREET_SUFFIXES = [
  'Street', 'St', 'Avenue', 'Ave', 'Road', 'Rd', 'Boulevard', 'Blvd',
  'Drive', 'Dr', 'Lane', 'Ln', 'Court', 'Ct', 'Place', 'Pl',
  'Way', 'Terrace', 'Ter', 'Circle', 'Cir', 'Highway', 'Hwy'
];

/**
 * Clean and normalize address string
 */
function cleanAddressString(str) {
  if (!str) return '';
  
  return str
    .replace(/\r\n/g, ' ')  // Replace line breaks with spaces
    .replace(/\n/g, ' ')    // Replace newlines with spaces
    .replace(/\r/g, ' ')    // Replace carriage returns with spaces
    .replace(/\s+/g, ' ')   // Replace multiple spaces with single space
    .trim();
}

/**
 * Enhanced address string parser with multiple strategies
 */
function parseAddressString(addressStr) {
  if (!addressStr || typeof addressStr !== 'string') {
    return null;
  }

  // Clean up the address string
  let cleanAddress = cleanAddressString(addressStr);
  
  // Initialize result object
  const result = {
    streetAddress: '',
    city: '',
    state: '',
    zipCode: '',
    country: '',
    isParsed: false,
    parsingMethod: '',
    confidence: 0
  };

  // Strategy 1: Try to extract ZIP code first (most reliable)
  const zipPattern = /(\d{5}(?:-\d{4})?)/;
  const zipMatch = cleanAddress.match(zipPattern);
  if (zipMatch) {
    result.zipCode = zipMatch[1];
    result.confidence += 20;
    // Remove ZIP from address for further parsing
    cleanAddress = cleanAddress.replace(zipMatch[0], '').replace(/,\s*,/, ',').trim();
  }

  // Strategy 2: Try to extract state (2-letter abbreviation or full name)
  let stateFound = false;
  const statePatterns = [
    /,\s*([A-Z]{2})\s*,/i,  // State between commas
    /,\s*([A-Z]{2})\s*$/i,  // State at end
    /,\s*([A-Z]{2})\s*(\d{5})/i,  // State before ZIP
    /,\s*(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\s*,/i
  ];

  for (const pattern of statePatterns) {
    const match = cleanAddress.match(pattern);
    if (match) {
      const state = match[1].toUpperCase();
      result.state = STATE_MAPPING[state] || state;
      stateFound = true;
      result.confidence += 15;
      // Remove state from address
      cleanAddress = cleanAddress.replace(match[0], ',').replace(/,\s*,/, ',').trim();
      break;
    }
  }

  // Strategy 3: Try to extract country
  const countryPatterns = [
    /,\s*(United States|USA|US|Canada|CA|UK|United Kingdom|England|Australia|AU|France|FR|Germany|DE|Italy|IT|Spain|ES)\s*,/i,
    /,\s*(United States|USA|US|Canada|CA|UK|United Kingdom|England|Australia|AU|France|FR|Germany|DE|Italy|IT|Spain|ES)\s*$/i
  ];

  for (const pattern of countryPatterns) {
    const match = cleanAddress.match(pattern);
    if (match) {
      const country = match[1];
      result.country = COUNTRY_MAPPING[country] || country;
      result.confidence += 10;
      // Remove country from address
      cleanAddress = cleanAddress.replace(match[0], ',').replace(/,\s*,/, ',').trim();
      break;
    }
  }

  // Strategy 4: Parse remaining parts
  const parts = cleanAddress.split(',').map(part => part.trim()).filter(part => part.length > 0);
  
  if (parts.length >= 2) {
    // First part is usually street address
    result.streetAddress = parts[0];
    
    // Second part is usually city
    result.city = parts[1];
    result.confidence += 15;
    
    // If we have more parts and no state found, try to extract from remaining parts
    if (parts.length > 2 && !stateFound) {
      for (let i = 2; i < parts.length; i++) {
        const part = parts[i];
        // Check if this part looks like a state
        if (/^[A-Z]{2}$/i.test(part)) {
          result.state = STATE_MAPPING[part.toUpperCase()] || part;
          result.confidence += 10;
          break;
        }
      }
    }
    
    result.isParsed = true;
    result.parsingMethod = 'comma-separated';
  } else if (parts.length === 1) {
    // Single part - might be just street address or street + city
    const singlePart = parts[0];
    
    // Check if it contains a street suffix followed by city
    for (const suffix of STREET_SUFFIXES) {
      const suffixPattern = new RegExp(`(.+\\b${suffix}\\b)\\s+(.+)$`, 'i');
      const match = singlePart.match(suffixPattern);
      if (match) {
        result.streetAddress = match[1].trim();
        result.city = match[2].trim();
        result.isParsed = true;
        result.parsingMethod = 'suffix-based';
        result.confidence += 20;
        break;
      }
    }
    
    if (!result.isParsed) {
      // Try to parse space-separated address parts
      const spaceParts = singlePart.split(/\s+/);
      if (spaceParts.length >= 3) {
        // Look for ZIP code at the end
        const lastPart = spaceParts[spaceParts.length - 1];
        if (/^\d{5}(?:-\d{4})?$/.test(lastPart)) {
          result.zipCode = lastPart;
          spaceParts.pop(); // Remove ZIP from parts
        }
        
        // Look for state abbreviation (2 letters) near the end
        for (let i = spaceParts.length - 1; i >= 0; i--) {
          const part = spaceParts[i];
          if (/^[A-Z]{2}$/i.test(part) && STATE_MAPPING[part.toUpperCase()]) {
            result.state = STATE_MAPPING[part.toUpperCase()] || part;
            spaceParts.splice(i, 1); // Remove state from parts
            break;
          }
        }
        
        // Remaining parts: first is street, rest is city
        if (spaceParts.length >= 2) {
          result.streetAddress = spaceParts[0];
          result.city = spaceParts.slice(1).join(' ');
          result.isParsed = true;
          result.parsingMethod = 'space-separated';
          result.confidence += 15;
        }
      }
      
      if (!result.isParsed) {
        // Treat as street address only
        result.streetAddress = singlePart;
        result.isParsed = true;
        result.parsingMethod = 'single-part';
        result.confidence += 5;
      }
    }
  }

  // Strategy 5: Try to extract city from common patterns
  if (!result.city || result.city === '') {
    // Look for city patterns like "NY, NY" or "Los Angeles, CA"
    const cityStatePattern = /([A-Za-z\s]+),\s*([A-Z]{2})/i;
    const cityMatch = cleanAddress.match(cityStatePattern);
    if (cityMatch) {
      result.city = cityMatch[1].trim();
      if (!result.state) {
        result.state = STATE_MAPPING[cityMatch[2].toUpperCase()] || cityMatch[2];
      }
      result.confidence += 10;
    }
  }

  // Apply default values for missing fields
  if (!result.city || result.city.trim() === '') {
    result.city = DEFAULT_VALUES.city;
  }
  if (!result.state || result.state.trim() === '') {
    result.state = DEFAULT_VALUES.state;
  }
  if (!result.zipCode || result.zipCode.trim() === '') {
    result.zipCode = DEFAULT_VALUES.zipCode;
  }
  if (!result.country || result.country.trim() === '') {
    result.country = DEFAULT_VALUES.country;
  }

  return result;
}

/**
 * Clean and standardize address data with enhanced parsing
 */
function cleanAddress(address) {
  if (!address || typeof address !== 'object') {
    return null;
  }

  // Create a copy of the original address to modify
  const cleaned = { ...address };

  // Clean and standardize the address fields
  let streetAddress = address.AddressLine1 || '';
  let city = address.City || '';
  let state = address.State || '';
  let zipCode = address.ZipCode || '';
  let country = DEFAULT_VALUES.country;

  // Clean up the street address if it contains additional information
  if (streetAddress && streetAddress.includes(',')) {
    const parsed = parseAddressString(streetAddress);
    if (parsed && parsed.streetAddress) {
      streetAddress = parsed.streetAddress;
      // Only use parsed city/state/zip if the original fields are empty
      if (!city || city.trim() === '') {
        city = parsed.city || '';
      }
      if (!state || state.trim() === '') {
        state = parsed.state || '';
      }
      if (!zipCode || zipCode.trim() === '') {
        zipCode = parsed.zipCode || '';
      }
    }
  }

  // Apply default values for missing fields
  if (!city || city.trim() === '') {
    city = DEFAULT_VALUES.city;
  }
  if (!state || state.trim() === '') {
    state = DEFAULT_VALUES.state;
  }
  if (!zipCode || zipCode.trim() === '') {
    zipCode = DEFAULT_VALUES.zipCode;
  }
  if (!country || country.trim() === '') {
    country = DEFAULT_VALUES.country;
  }

  // Update the cleaned address with the standardized values
  cleaned.AddressLine1 = streetAddress.trim();
  cleaned.City = city.trim();
  cleaned.State = state.trim();
  cleaned.ZipCode = zipCode.trim();
  cleaned.country = country.trim();

  return cleaned;
}

/**
 * Main function to update addresses with enhanced parsing
 */
async function updateAddresses() {
  try {
    console.log('Reading addresses file...');
    
    // Read the original addresses file
    const addressesPath = path.join(__dirname, '../extracted-data/addresses.json');
    const addressesData = JSON.parse(fs.readFileSync(addressesPath, 'utf8'));
    
    console.log(`Found ${addressesData.length} addresses to process`);
    
    // Process each address
    const processedAddresses = [];
    let cleanedCount = 0;
    let defaultedCount = 0;
    let confidenceScores = { low: 0, medium: 0, high: 0 };
    
    for (let i = 0; i < addressesData.length; i++) {
      const address = addressesData[i];
      const cleaned = cleanAddress(address);
      
      if (cleaned) {
        // Count addresses that were cleaned
        cleanedCount++;
        
        // Count addresses with default values
        if (cleaned.City === DEFAULT_VALUES.city || 
            cleaned.State === DEFAULT_VALUES.state || 
            cleaned.ZipCode === DEFAULT_VALUES.zipCode) {
          defaultedCount++;
        }
        
        // Calculate confidence based on available fields
        let fieldConfidence = 0;
        if (cleaned.AddressLine1) fieldConfidence += 20;
        if (cleaned.City) fieldConfidence += 20;
        if (cleaned.State) fieldConfidence += 20;
        if (cleaned.ZipCode) fieldConfidence += 20;
        
        // Categorize confidence
        if (fieldConfidence >= 50) confidenceScores.high++;
        else if (fieldConfidence >= 25) confidenceScores.medium++;
        else confidenceScores.low++;
        
        processedAddresses.push(cleaned);
      }
      
      // Progress indicator
      if ((i + 1) % 1000 === 0) {
        console.log(`Processed ${i + 1}/${addressesData.length} addresses...`);
      }
    }
    
    // Write the processed addresses to the existing addresses-parsed.json file
    const outputPath = path.join(__dirname, '../extracted-data/addresses-parsed.json');
    fs.writeFileSync(outputPath, JSON.stringify(processedAddresses, null, 2));
    
    console.log('\nAddresses updated with enhanced parsing!');
    console.log(`Total addresses processed: ${processedAddresses.length}`);
    console.log(`Addresses cleaned: ${cleanedCount}`);
    console.log(`Addresses with default values: ${defaultedCount}`);
    console.log(`Updated file: ${outputPath}`);
    
    console.log('\nConfidence scores:');
    console.log(`  High (≥50): ${confidenceScores.high}`);
    console.log(`  Medium (25-49): ${confidenceScores.medium}`);
    console.log(`  Low (<25): ${confidenceScores.low}`);
    
    // Show some examples
    console.log('\nSample processed addresses:');
    processedAddresses.slice(0, 5).forEach((addr, index) => {
      console.log(`\n${index + 1}. ${addr.AddressLine1}`);
      console.log(`   ${addr.City}, ${addr.State} ${addr.ZipCode}`);
      console.log(`   Country: ${addr.country || 'United States'}`);
      console.log(`   Address Name: ${addr.AddressName}`);
    });
    
  } catch (error) {
    console.error('Error processing addresses:', error);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  updateAddresses();
}

module.exports = {
  cleanAddress,
  parseAddressString,
  updateAddresses
};