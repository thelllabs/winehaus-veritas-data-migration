# LLM Script Instructions for Veritas Data Migration Project

## 🚫 DO NOT CREATE

- **Markdown (.md) files** - These are documentation files, not migration scripts
- **README files** - Use existing documentation structure
- **Separate documentation files** - Keep instructions in code comments

## ✅ ALWAYS DO

- **Extract ALL data** - Not just active records
- **Include inactive, deleted, and historical records**
- **Preserve complete data integrity** for migration purposes
- **Follow existing script patterns** from wine-data scripts
- **Use pnpm** for package management (as per user rules)
- **Create executable Node.js scripts** in the `scripts/` directory
- **Add npm scripts** to `package.json` for easy execution
- **Include comprehensive error handling** and logging
- **Support multiple output formats** (JSON, CSV, SQL)
- **Store legacy IDs** for future reference and reconciliation
- **Handle data relationships** and foreign key mappings
- **Provide clear console output** with emojis and progress indicators

## 📁 File Structure

```
scripts/
├── extract-[entity]-data.js    # Data extraction script
├── import-[entity]-data.js     # Data import script
└── test-[entity]-extraction.js # Connection test script
```

## 🔧 Script Requirements

### Extraction Scripts
- Connect to legacy SQL Server database
- Extract data from all relevant tables
- Support multiple output formats
- Include comprehensive error handling
- Follow the `LegacyDataExtractor` class pattern

### Import Scripts
- Connect to PostgreSQL database
- Import extracted data with proper mapping
- Handle data relationships and dependencies
- Include rollback capabilities
- Follow the `LegacyDataSeeder` class pattern

### Test Scripts
- Test database connectivity
- Verify table access
- Provide troubleshooting guidance
- Use existing extraction classes

## 📊 Data Handling

- **Never filter by active status** - extract everything
- **Preserve all relationships** between tables
- **Map legacy IDs** to new UUIDs
- **Handle data type conversions** appropriately
- **Include all historical records** and audit trails
- **Support soft deletes** and inactive records

## 🎯 Naming Conventions

- Scripts: `extract-[entity]-data.js`, `import-[entity]-data.js`
- Classes: `Legacy[Entity]DataExtractor`, `Legacy[Entity]DataSeeder`
- Functions: descriptive names with clear purpose
- Variables: camelCase with descriptive names

## 📝 Code Style

- Use ES6+ features (const, let, arrow functions, async/await)
- Include comprehensive JSDoc comments
- Follow existing error handling patterns
- Use consistent logging format with emojis
- Include proper error messages and troubleshooting tips

## 🔄 Migration Process

1. **Extract** all data from legacy system
2. **Transform** data to new schema format
3. **Import** data into new system
4. **Validate** migration success
5. **Provide rollback** instructions

## 🚨 Error Handling

- **Connection errors** - Clear database connection issues
- **Query errors** - Specific SQL or data issues
- **Validation errors** - Data quality problems
- **Permission errors** - Access control issues
- **Network errors** - Connectivity problems

## 📋 Required Dependencies

All scripts should use existing project dependencies:
- `mssql` - SQL Server connection
- `typeorm` - PostgreSQL connection
- `uuid` - ID generation
- `commander` - CLI argument parsing
- `dotenv` - Environment configuration

## 🎉 Success Indicators

- Clear progress reporting
- Record counts for each table
- Success/failure summaries
- Next step instructions
- Validation queries provided

---

**Remember**: This project is about complete data migration, not selective data transfer. Every record matters for business continuity and compliance.
