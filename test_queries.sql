-- Create some test users and set up profiles

-- First, create an admin user
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('11111111-1111-1111-1111-111111111111', 'admin@example.com', '{}');
INSERT INTO public.profiles (id, full_name, role, status, setup_complete) VALUES ('11111111-1111-1111-1111-111111111111', 'Admin User', 'admin', 'approved', true);

-- Create a resident user
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('22222222-2222-2222-2222-222222222222', 'resident@example.com', '{}');
INSERT INTO public.profiles (id, full_name, role, status, setup_complete) VALUES ('22222222-2222-2222-2222-222222222222', 'Resident User', 'resident', 'approved', true);

-- Get the ID of AGS-001
DO $$
DECLARE
  v_device_id UUID;
BEGIN
  SELECT id INTO v_device_id FROM public.devices WHERE device_code = 'AGS-001';
  -- Assign resident to AGS-001
  UPDATE public.profiles SET device_id = v_device_id WHERE id = '22222222-2222-2222-2222-222222222222';
END $$;

-- Test as admin
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

SELECT count(*) from devices_safe;
SELECT count(*) from devices_safe where api_key is not null;

-- Test as resident
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

SELECT count(*) from devices_safe;
SELECT count(*) from devices_safe where api_key is null;
