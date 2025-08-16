WITH tbl AS (
  SELECT c.oid AS relid, n.nspname AS TABLE_SCHEMA, c.relname AS TABLE_NAME
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p') -- base & partitioned tables
    AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
),
cols AS (
  SELECT a.attrelid AS relid,
         a.attnum,
         a.attname AS COLUMN_NAME,
         format_type(a.atttypid, a.atttypmod) AS DATA_TYPE,
         CASE WHEN a.atttypmod > 0 
              AND a.atttypid IN (1043, 25, 1042) -- varchar, text, char
              THEN CASE WHEN a.atttypmod - 4 > 0 THEN a.atttypmod - 4 ELSE NULL END
              ELSE NULL
         END AS CHARACTER_MAXIMUM_LENGTH,
         CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS IS_NULLABLE,
         pg_get_expr(ad.adbin, ad.adrelid) AS COLUMN_DEFAULT
  FROM pg_attribute a
  LEFT JOIN pg_attrdef ad
         ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped
)
SELECT jsonb_pretty(
  jsonb_build_object(
    'database_schema',
      (
        SELECT jsonb_agg(
          -- Force property order by manually concatenating JSON text
          (
            ('{' ||
              '"TABLE_SCHEMA": ' || to_jsonb(t.TABLE_SCHEMA)::text || ',' ||
              '"TABLE_NAME": '   || to_jsonb(t.TABLE_NAME)::text   || ',' ||
              '"columns": '     ||
                (
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'COLUMN_NAME', c.COLUMN_NAME,
                      'DATA_TYPE', c.DATA_TYPE,
                      'CHARACTER_MAXIMUM_LENGTH', c.CHARACTER_MAXIMUM_LENGTH,
                      'IS_NULLABLE', c.IS_NULLABLE,
                      'COLUMN_DEFAULT', c.COLUMN_DEFAULT
                    )
                    ORDER BY c.attnum
                  )::text
                  FROM cols c WHERE c.relid = t.relid
                ) ||
            '}')::jsonb
          )
          ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
        )
        FROM tbl t
      )
  )
) AS schema_json;
