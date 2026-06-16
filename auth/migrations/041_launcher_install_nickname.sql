-- 041_launcher_install_nickname.sql
-- A friendly, admin-editable label for each kiosk so machines are easy to spot
-- in the Kiosk Installs panel (e.g. "Salem Front Desk") instead of a hostname.

ALTER TABLE launcher_installs ADD COLUMN IF NOT EXISTS nickname text;
