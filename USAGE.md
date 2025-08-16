# Veritas Data Migration Usage Guide

This repository contains scripts for extracting wine data from a legacy database and importing it into a new Veritas database structure.

## Prerequisites

- Node.js 16+ installed
- PostgreSQL database running
- Access to legacy database (for extraction)
- Access to new Veritas database (for import)

## Installation

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Create a `.env` file with your database configuration:
   ```bash
   cp .env.example .env
   # Edit .env with your actual database credentials
   ```

## Usage

### Extract Wine Data from Legacy Database

```bash
pnpm run extract
```

This will:
- Connect to the legacy database
- Extract wine-related data into JSON files
- Save files in the `extracted-data/` directory

### Import Wine Data to New Database

```bash
pnpm run import
```

This will:
- Connect to the new Veritas database
- Create a default tenant if it doesn't exist
- Import all wine data in the correct dependency order
- Skip existing records to avoid duplicates

## Environment Variables

Create a `.env` file with the following variables:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=winehaus
```

## Data Flow

1. **Extraction**: Legacy database → JSON files
2. **Import**: JSON files → New Veritas database

The import process follows this dependency order:
1. Wine Countries
2. Wine Regions  
3. Wine Villages
4. Wine Producers
5. Wine Brands
6. Wine Varietals
7. Wine Styles
8. Wine Types (Colors)
9. Wines (with relationships)

## Troubleshooting

- Ensure your database connection details are correct
- Check that the `extracted-data/` directory contains the required JSON files
- Verify that the target database has the correct table structure
- Check console output for detailed error messages

## Scripts

- `pnpm run extract` - Extract wine data from legacy database
- `pnpm run import` - Import wine data to new database
- `pnpm start` - Alias for import command
