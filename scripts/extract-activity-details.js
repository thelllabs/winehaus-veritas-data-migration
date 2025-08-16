const fs = require('fs');
const path = require('path');

/**
 * Extract activity details for a specific activity ID
 * @param {number} activityId - The activity ID to filter by
 * @param {string} outputFilename - The output filename (optional, will auto-generate if not provided)
 */
function extractActivityDetails(activityId, outputFilename = null) {
    try {
        // Read the activity details data
        const inputPath = path.join(__dirname, '..', 'extracted-data', 'cases-activityDetails.json');
        const activityDetailsData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
        
        // Filter by the specified activity ID
        const filteredDetails = activityDetailsData.filter(detail => detail.ActivityID === activityId);
        
        if (filteredDetails.length === 0) {
            console.log(`No activity details found for ActivityID: ${activityId}`);
            return;
        }
        
        // Generate output filename if not provided
        if (!outputFilename) {
            outputFilename = `activity-details-${activityId}.json`;
        }
        
        // Ensure output filename has .json extension
        if (!outputFilename.endsWith('.json')) {
            outputFilename += '.json';
        }
        
        // Create output path
        const outputPath = path.join(__dirname, '..', 'data', outputFilename);
        
        // Write filtered data to output file
        fs.writeFileSync(outputPath, JSON.stringify(filteredDetails, null, 2));
        
        console.log(`Successfully extracted ${filteredDetails.length} activity details for ActivityID: ${activityId}`);
        console.log(`Output saved to: ${outputPath}`);
        
        // Display summary of extracted data
        console.log('\nExtracted Activity Details Summary:');
        filteredDetails.forEach((detail, index) => {
            console.log(`${index + 1}. ActivityDetailID: ${detail.ActivityDetailID}`);
            console.log(`   WineItemID: ${detail.WineItemID}`);
            console.log(`   Quantity: ${detail.Quantity}`);
            console.log(`   ActivityType: ${detail.ActivityType}`);
            console.log(`   CaseID: ${detail.CaseID}`);
            console.log(`   DateCreated: ${detail.DateCreated}`);
            console.log('');
        });
        
    } catch (error) {
        console.error('Error extracting activity details:', error.message);
        process.exit(1);
    }
}

// Check if script is run directly
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node extract-activity-details.js <activityId> [outputFilename]');
        console.log('Example: node extract-activity-details.js 95756');
        console.log('Example: node extract-activity-details.js 95756 custom-filename.json');
        process.exit(1);
    }
    
    const activityId = parseInt(args[0]);
    const outputFilename = args[1] || null;
    
    if (isNaN(activityId)) {
        console.error('Error: Activity ID must be a valid number');
        process.exit(1);
    }
    
    extractActivityDetails(activityId, outputFilename);
}

module.exports = { extractActivityDetails };
