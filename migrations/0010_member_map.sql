-- Member map — opt-in, coarse location only (self-typed city/country,
-- geocoded once client-side via OpenStreetMap Nominatim — never browser
-- GPS, never automatic). A member simply not setting this means they
-- never appear on the map at all; there's no default/inferred location.

alter table profiles add column if not exists location_name text;
alter table profiles add column if not exists location_lat double precision;
alter table profiles add column if not exists location_lng double precision;
