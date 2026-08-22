alter table usuarios add column if not exists totp_secret text;
alter table usuarios add column if not exists totp_enabled boolean default false;
alter table usuarios add column if not exists totp_confirmed_at timestamptz;
