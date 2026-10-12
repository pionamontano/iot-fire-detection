-- Test fixtures (local harness only). Run as superuser after the migrations.
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@test.local'),
 ('00000000-0000-0000-0000-0000000000b1','resident1@test.local'),
 ('00000000-0000-0000-0000-0000000000b2','resident2@test.local'),
 ('00000000-0000-0000-0000-0000000000c1','responder@test.local'),
 ('00000000-0000-0000-0000-0000000000c2','pending-responder@test.local'),
 ('00000000-0000-0000-0000-0000000000d1','rejected-resident@test.local');
insert into devices(id,device_code,label,location_desc) values
 ('10000000-0000-0000-0000-000000000001','T-001','Unit 1','Loc 1'),
 ('10000000-0000-0000-0000-000000000002','T-002','Unit 2','Loc 2');
insert into profiles(id,full_name,role,status,device_id,contact_number,address) values
 ('00000000-0000-0000-0000-0000000000a1','Admin','admin','approved',null,'09000000001','a'),
 ('00000000-0000-0000-0000-0000000000b1','Resident One','resident','approved','10000000-0000-0000-0000-000000000001','09000000002','addr1'),
 ('00000000-0000-0000-0000-0000000000b2','Resident Two','resident','approved','10000000-0000-0000-0000-000000000002','09000000003','addr2'),
 ('00000000-0000-0000-0000-0000000000c1','Responder','bfp_responder','approved',null,'09000000004','a'),
 ('00000000-0000-0000-0000-0000000000c2','Pending Responder','bfp_responder','pending',null,'09000000005','a'),
 ('00000000-0000-0000-0000-0000000000d1','Rejected Resident','resident','rejected',null,'09000000006','a');
