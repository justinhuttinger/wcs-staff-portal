-- 212: WCS Save signed cancel request. The member types their name and draws a
-- signature before cancelling; the wcs-save Worker stores it here before any
-- ABC call and files a PDF of it to the member's ABC documents.
alter table save_requests add column if not exists signed_name text;
alter table save_requests add column if not exists signed_at timestamptz;
-- PNG, base64 without the data: prefix. Capped at 200 KB by the Worker.
alter table save_requests add column if not exists signature_png text;
alter table save_requests add column if not exists signature_ip text;
