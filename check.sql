"
SELECT current_database(),
       current_schema(),
       current_user,
       current_setting('server_version');

SELECT to_regclass('public."User"') AS "User";
"
