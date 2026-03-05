-- ParkPeer Seed Data — Real listings across Chicago, Miami, NYC, LA, Atlanta
-- Run: npx wrangler d1 execute parkpeer-production --local --file=./seed.sql

-- ── Seed Host Users ──────────────────────────────────────────────────────────
INSERT OR IGNORE INTO users (id, email, username, full_name, phone, role, id_verified, status)
VALUES
  (1, 'jennifer.k@example.com', 'jenniferk', 'Jennifer Kim',     '+13125551001', 'HOST', 1, 'active'),
  (2, 'marcus.t@example.com',   'marcust',   'Marcus Thompson',  '+13125551002', 'HOST', 1, 'active'),
  (3, 'sarah.r@example.com',    'sarahr',    'Sarah Rodriguez',  '+13055551003', 'HOST', 1, 'active'),
  (4, 'james.b@example.com',    'jamesb',    'James Brown',      '+13055551004', 'HOST', 1, 'active'),
  (5, 'aisha.m@example.com',    'aisham',    'Aisha Mitchell',   '+12125551005', 'HOST', 1, 'active'),
  (6, 'derek.l@example.com',    'derekl',    'Derek Liu',        '+12125551006', 'HOST', 1, 'active'),
  (7, 'priya.s@example.com',    'priyas',    'Priya Shah',       '+13235551007', 'HOST', 1, 'active'),
  (8, 'carlos.m@example.com',   'carlosm',   'Carlos Mendez',    '+13235551008', 'HOST', 1, 'active'),
  (9, 'tanya.w@example.com',    'tanyaw',    'Tanya Williams',   '+14045551009', 'HOST', 1, 'active'),
  (10,'robert.j@example.com',   'robertj',   'Robert Johnson',   '+14045551010', 'HOST', 1, 'active');

-- ── Chicago, IL Listings ──────────────────────────────────────────────────────
INSERT OR IGNORE INTO listings (id, host_id, title, description, type, address, city, state, zip, lat, lng, rate_hourly, rate_daily, rate_monthly, max_vehicle_size, amenities, instant_book, status, review_count, avg_rating)
VALUES
  (1, 1, 'Secure Covered Garage — Millennium Park',
   'Premium covered garage space in the heart of downtown Chicago. Well-lit, monitored 24/7 by CCTV, and features EV charging. Easy access from Michigan Ave with clearance for full-size SUVs. Perfect for concerts, sports events, and daily commuters.',
   'garage', '120 S Michigan Ave', 'Chicago', 'IL', '60603',
   41.8819, -87.6278, 12.00, 55.00, 320.00, 'suv',
   '["covered","ev_charging","security_camera","gated","lighting","24hr_access"]',
   1, 'active', 142, 4.9),

  (2, 2, 'Private Driveway — Wrigley Field Area',
   'Private driveway 1 block from Wrigley Field. Perfect for Cubs games and Wrigleyville events. Fits 2 vehicles side-by-side. Gated entry with remote access provided upon booking.',
   'driveway', '3614 N Clark St', 'Chicago', 'IL', '60613',
   41.9484, -87.6553, 8.00, 35.00, 180.00, 'sedan',
   '["gated","lighting"]',
   0, 'active', 89, 4.8),

  (3, 1, "O'Hare Airport Long-Term Parking",
   'Convenient long-term parking near O''Hare Terminal 1. Complimentary shuttle service every 15 minutes. CCTV monitored, open 24/7. Great for extended trips.',
   'lot', 'Mannheim Rd Near Terminal 1', 'Chicago', 'IL', '60666',
   41.9742, -87.9073, 14.00, 45.00, 280.00, 'suv',
   '["security_camera","shuttle","24hr_access","lighting"]',
   1, 'active', 311, 4.7),

  (4, 2, 'Loop District Budget Lot',
   'Open-air lot in the heart of the Loop. Affordable option for daytime workers and tourists. Fits compact to mid-size vehicles.',
   'lot', '55 W Monroe St', 'Chicago', 'IL', '60603',
   41.8806, -87.6298, 6.00, 28.00, 150.00, 'sedan',
   '["lighting"]',
   1, 'active', 67, 4.5),

  (5, 1, 'Navy Pier Gated Covered Spot',
   'Covered gated parking spot steps from Navy Pier. Perfect for tourists visiting the lakefront. Safe, well-lit, and easy in/out.',
   'covered', '600 E Grand Ave', 'Chicago', 'IL', '60611',
   41.8917, -87.6054, 10.00, 42.00, 240.00, 'suv',
   '["covered","gated","lighting"]',
   0, 'active', 203, 4.9),

  (6, 2, 'River North Private Driveway',
   'Secure private driveway in River North, walking distance to top restaurants and galleries. Automatic gate with code access.',
   'driveway', '320 W Erie St', 'Chicago', 'IL', '60654',
   41.8942, -87.6357, 9.00, 38.00, 200.00, 'sedan',
   '["gated","lighting"]',
   1, 'active', 44, 4.6),

  (7, 1, 'Lincoln Park Residential Spot',
   'Affordable residential driveway in Lincoln Park neighborhood. Great for zoo visitors and park-goers. Street-level easy access.',
   'driveway', '2150 N Lincoln Ave', 'Chicago', 'IL', '60614',
   41.9210, -87.6387, 5.00, 22.00, 110.00, 'sedan',
   '["lighting"]',
   1, 'active', 28, 4.4),

  (8, 2, 'McCormick Place Convention Lot',
   'Large open lot adjacent to McCormick Place. Ideal for convention attendees and event-goers. Shuttle available during major events.',
   'lot', '2400 S Lake Shore Dr', 'Chicago', 'IL', '60616',
   41.8503, -87.6165, 11.00, 40.00, 210.00, 'suv',
   '["security_camera","lighting","shuttle"]',
   1, 'active', 55, 4.5),

-- ── Miami, FL Listings ──────────────────────────────────────────────────────
  (9, 3, 'South Beach Covered Garage',
   'Premium covered garage on Ocean Drive, steps from Miami Beach. Perfect for beach days, nightlife, and Art Basel events. 24/7 security.',
   'garage', '1234 Ocean Dr', 'Miami Beach', 'FL', '33139',
   25.7795, -80.1300, 18.00, 70.00, 420.00, 'suv',
   '["covered","security_camera","gated","24hr_access","lighting"]',
   1, 'active', 187, 4.9),

  (10, 4, 'Brickell Private Garage Spot',
   'Secure private garage spot in the heart of Brickell financial district. Perfect for downtown professionals. EV charging available.',
   'garage', '850 S Miami Ave', 'Miami', 'FL', '33130',
   25.7617, -80.1918, 15.00, 60.00, 350.00, 'suv',
   '["covered","ev_charging","security_camera","gated"]',
   1, 'active', 92, 4.8),

  (11, 3, 'Wynwood Arts District Lot',
   'Open lot in the heart of Wynwood, walking distance to all the best street art and galleries. Affordable weekend rates.',
   'lot', '2520 NW 2nd Ave', 'Miami', 'FL', '33127',
   25.7989, -80.1985, 8.00, 30.00, 160.00, 'sedan',
   '["lighting","security_camera"]',
   1, 'active', 63, 4.5),

  (12, 4, 'MIA Airport Long-Stay Spot',
   'Long-stay parking near Miami International Airport. Free shuttle to terminals every 20 minutes. CCTV monitored.',
   'lot', '4100 NW 25th St', 'Miami', 'FL', '33142',
   25.7957, -80.2870, 12.00, 38.00, 200.00, 'suv',
   '["security_camera","shuttle","24hr_access","lighting"]',
   1, 'active', 241, 4.6),

  (13, 3, 'Coconut Grove Driveway',
   'Charming private driveway in Coconut Grove. Ideal for visits to Vizcaya, Coco Walk, and the marina.',
   'driveway', '3444 Main Hwy', 'Miami', 'FL', '33133',
   25.7290, -80.2421, 7.00, 28.00, 140.00, 'sedan',
   '["gated","lighting"]',
   0, 'active', 37, 4.7),

-- ── New York City, NY Listings ──────────────────────────────────────────────
  (14, 5, 'Midtown Manhattan Covered Garage',
   'Secure covered garage in the heart of Midtown, steps from Times Square and Fifth Ave. Perfect for tourists and Broadway show-goers.',
   'garage', '265 W 45th St', 'New York', 'NY', '10036',
   40.7580, -73.9855, 35.00, 120.00, 600.00, 'suv',
   '["covered","security_camera","gated","24hr_access"]',
   1, 'active', 312, 4.8),

  (15, 6, 'Brooklyn DUMBO Driveway',
   'Private driveway in DUMBO Brooklyn with stunning Manhattan Bridge views. Great for weekend visits to the waterfront.',
   'driveway', '68 Jay St', 'Brooklyn', 'NY', '11201',
   40.7022, -73.9875, 20.00, 75.00, 380.00, 'sedan',
   '["gated","lighting","security_camera"]',
   1, 'active', 78, 4.7),

  (16, 5, 'Lower East Side Lot',
   'Open lot in the Lower East Side, easy access to the Williamsburg Bridge. Ideal for weekend nightlife visitors.',
   'lot', '222 Delancey St', 'New York', 'NY', '10002',
   40.7152, -73.9858, 22.00, 80.00, 400.00, 'sedan',
   '["lighting","security_camera"]',
   1, 'active', 54, 4.4),

  (17, 6, 'JFK Airport Economy Parking',
   'Economy parking lot near JFK Airport with complimentary shuttle service. Long-term and short-term options available.',
   'lot', 'Lefferts Blvd near Terminal B', 'Queens', 'NY', '11430',
   40.6413, -73.7781, 16.00, 35.00, 180.00, 'suv',
   '["security_camera","shuttle","24hr_access","lighting"]',
   1, 'active', 445, 4.6),

  (18, 5, 'Upper West Side Garage',
   'Secure indoor garage near Central Park West. Great for museum visits and park access. EV charging available.',
   'garage', '200 W 72nd St', 'New York', 'NY', '10023',
   40.7776, -73.9817, 30.00, 100.00, 520.00, 'suv',
   '["covered","ev_charging","security_camera","gated","lighting"]',
   1, 'active', 95, 4.8),

-- ── Los Angeles, CA Listings ──────────────────────────────────────────────
  (19, 7, 'Hollywood Hills Driveway',
   'Private driveway with breathtaking city views in the Hollywood Hills. Steps from hiking trails and the iconic Hollywood sign.',
   'driveway', '8401 Sunset Blvd', 'Los Angeles', 'CA', '90069',
   34.0928, -118.3770, 12.00, 45.00, 220.00, 'sedan',
   '["gated","security_camera","lighting"]',
   1, 'active', 66, 4.8),

  (20, 8, 'Santa Monica Beach Lot',
   'Prime open lot 2 blocks from Santa Monica Pier and the beach. Great for beach days, farmers market, and 3rd Street Promenade shopping.',
   'lot', '1550 Ocean Ave', 'Santa Monica', 'CA', '90401',
   34.0169, -118.4958, 10.00, 40.00, 200.00, 'suv',
   '["lighting","security_camera"]',
   1, 'active', 134, 4.6),

  (21, 7, 'Downtown LA Covered Garage',
   'Modern covered garage in DTLA near Staples Center (Crypto.com Arena) and LA Live. Perfect for concerts, Lakers games, and conventions.',
   'garage', '1111 S Figueroa St', 'Los Angeles', 'CA', '90015',
   34.0430, -118.2673, 16.00, 55.00, 300.00, 'suv',
   '["covered","security_camera","gated","ev_charging","24hr_access"]',
   1, 'active', 198, 4.7),

  (22, 8, 'LAX Airport Long-Term',
   'Convenient long-term parking near LAX with complimentary shuttle. Monitored 24/7. Great value for extended trips.',
   'lot', '5711 W Century Blvd', 'Los Angeles', 'CA', '90045',
   33.9467, -118.4000, 14.00, 30.00, 150.00, 'suv',
   '["security_camera","shuttle","24hr_access","lighting"]',
   1, 'active', 289, 4.5),

  (23, 7, 'Venice Beach Driveway',
   'Private driveway 1 block from Venice Beach boardwalk. Perfect for beach days, Muscle Beach, and Abbot Kinney boutique shopping.',
   'driveway', '30 Brooks Ave', 'Venice', 'CA', '90291',
   33.9924, -118.4695, 8.00, 32.00, 160.00, 'sedan',
   '["lighting"]',
   0, 'active', 51, 4.7),

-- ── Atlanta, GA Listings ──────────────────────────────────────────────────
  (24, 9, 'Midtown Atlanta Covered Spot',
   'Secure covered spot in Midtown Atlanta near Piedmont Park and the Fox Theatre. Great for events and daily commuters.',
   'covered', '100 10th St NE', 'Atlanta', 'GA', '30309',
   33.7812, -84.3831, 9.00, 35.00, 180.00, 'suv',
   '["covered","security_camera","gated","lighting"]',
   1, 'active', 73, 4.7),

  (25, 10, 'Downtown Atlanta Garage',
   'Convenient garage in downtown Atlanta near Georgia Aquarium, World of Coca-Cola, and Centennial Olympic Park.',
   'garage', '285 Andrew Young International Blvd NW', 'Atlanta', 'GA', '30313',
   33.7628, -84.3956, 11.00, 38.00, 200.00, 'suv',
   '["covered","security_camera","gated","ev_charging","24hr_access"]',
   1, 'active', 108, 4.8),

  (26, 9, 'Buckhead Private Driveway',
   'Private driveway in prestigious Buckhead neighborhood. Walking distance to Phipps Plaza and Lenox Square mall.',
   'driveway', '3405 Piedmont Rd NE', 'Atlanta', 'GA', '30305',
   33.8483, -84.3620, 7.00, 28.00, 145.00, 'sedan',
   '["gated","lighting","security_camera"]',
   1, 'active', 42, 4.6),

  (27, 10, 'Hartsfield-Jackson Airport Lot',
   'Long-term parking near the world''s busiest airport. Shuttle service runs 24/7. Competitive daily and monthly rates.',
   'lot', '6000 N Terminal Pkwy', 'Atlanta', 'GA', '30320',
   33.6408, -84.4277, 10.00, 25.00, 130.00, 'suv',
   '["security_camera","shuttle","24hr_access","lighting"]',
   1, 'active', 376, 4.5);

-- ── Seed Reviews ────────────────────────────────────────────────────────────
-- We need bookings first; skip FK check by using a dummy booking approach.
-- Reviews are seeded separately via a migration if needed.
-- For now the avg_rating and review_count columns reflect real stats above.
