/**
 * Test fixtures of docs/tools/specs/jwt.md §10: the published examples of RFC 7515 and RFC 8037, the specification's own
 * sample tokens (HS256 and HS512 signed with its test secret `tools-test-secret-0123456789abcdef!`; RS256, PS256 and
 * ES256 with the test keys of the x509 specification) and its public test keys and certificates. None of them belongs
 * to a real system. The secret scanner flags anything shaped like a JWT, so each such line says it is a sample.
 */

// A published sample token (RFC 7515 Appendix A), not a credential.
export const RFC7515_A1 =
  'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'; // gitleaks:allow

// A published sample key (RFC 7515 Appendix A.1).
export const RFC7515_A1_K = 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow'; // gitleaks:allow

// A published sample token (RFC 7515 Appendix A), not a credential.
export const RFC7515_A3 =
  'eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.DtEhU3ljbEg8L38VWAfUAqOyKAM6-Xx-F4GawxaepmXFCgfTjDxw5djxLa8ISlSApmWQxfKTUJqPP3-Kg6NU1Q'; // gitleaks:allow

// A published sample key (RFC 7515 Appendix A).
export const RFC7515_A3_JWK =
  '{"kty":"EC","crv":"P-256","x":"f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU","y":"x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"}'; // gitleaks:allow

// A public test key of the specification.
export const RFC7515_A3_SPKI = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEf83OJ3D2xF1Bg8vub9tLe1gHMzV7
6e8Tus9uPHvRVEXH8UTNG72bfocs3+257rn0s2ldbqkLJK2KRiMohYjlrQ==
-----END PUBLIC KEY-----`;
// A published sample token (RFC 8037 Appendix A.4), not a credential.
export const RFC8037_A4 =
  'eyJhbGciOiJFZERTQSJ9.RXhhbXBsZSBvZiBFZDI1NTE5IHNpZ25pbmc.hgyY0il_MGCjP0JzlnLWG1PPOt7-09PGcvMg3AIbQR6dWbhijcNR4ki4iylGjg5BhVsPt9g7sVvpAr_MuM0KAg'; // gitleaks:allow

// A published sample key (RFC 8037 Appendix A.4).
export const RFC8037_A4_JWK = '{"kty":"OKP","crv":"Ed25519","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T1 =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTc2MzU1MzYwMCwibmJmIjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.EGtiSsrqY5aOYhAICf6R9A5yr17V9Qdvjqsg0nJLFX4'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T2 =
  'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTc2MzU1MzYwMCwibmJmIjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.ShG-FhF_tHx9CS_jwil-JVEFoyMRYKVdLI-8IVdRXEjjvcuue6hPlKV6vMrCZO5yBB3JfCYj6yZPpXN2paz-bw'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T3 =
  'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyLTQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTc2MzU1MzYwMCwibmJmIjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T4 =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoixb1vZmllIPCfmYIiLCJhdWQiOlsiYXBpIiwid2ViIl19.vgOjObMafjF8BuhPeyAHdCy5jAuzkotVkTWJo8Tn2gw'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T5 =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NjM1NTcyMDAwMDB9.fdQ94CiQ00cncPAkX3tLYYKrl6apoN41o27IWeKns50'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T6 =
  'eyJhbGciOiJIUzI1NiIsImNyaXQiOlsiZXhwIl0sImV4cCI6MX0.eyJzdWIiOiJ1c2VyLTQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTc2MzU1MzYwMCwibmJmIjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.uyOzsSSmeCwVaFSc1-lmrWav-m1EU7QgqG4HpSh2DhU'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T7 =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIzNDU2Nzg5MDEyMzQ1Njc4OTAsImlhdCI6MTc2MzU1MzYwMH0.1CqOnAnax-2MOoXtGrIJdde1XhjT_eaV6G3BtAC0vkM'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T8 =
  'eyJhbGciOiJIUzI1NiIsImp3ayI6eyJrdHkiOiJvY3QiLCJrIjoiQUFBQSJ9fQ.eyJzdWIiOiJ1c2VyLTQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTc2MzU1MzYwMCwibmJmIjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.AZoLligB556uJxqeiqB2t1ytRNawDIRWcg8zSW0TK8o'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T9 =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTc2MzU1MzYwMCwibmJmIjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.QMw0NwBu7b91ONlo9gZebHd3_-En6ZO-DLH-HgNdlco'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T10 =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTc2MzU1MzYwMCwibmJmIjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.HoZ0MC1qwwDyKiWRQOKmt6uqCZ0U2rnZqxw6cW3ekIY'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T11 = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..AAAAAAAAAAAAAAAA.AAAA.AAAAAAAAAAAAAAAAAAAAAA'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T_RS256 =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmaXh0dXJlIiwiaWF0IjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.bT7mYXgMn3Iz9US4R01Wsdtsh8zzTEOGYzG1fx8YgEE2Kv_ehmAFd1f1Ndt960ve3mDHaN-oJV_juh30X8_-oLWK-3_t15pZ0o1LTF5ojc2AFKmkeGheJMvBIuf2zy3npF4K5tzvzmdEwdWax4O5hQsTc_TpiWC6b191qL07Hvjw1ZJAJc_BDODculi3S6vfV1bvTOccKt8tIu_5_nbr3_NQilvFSFBJKlhQvaEnrnLzF5h9PXkoSXPUqV47ccymSE4AUZy1ewmWHc1BMHS5X3k-iu3YP3oMz8KMA_uxtDskQ-q-k8ieHC31F_WII1RZxyJxQKjYjHzJBH2C82o97g'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T_PS256 =
  'eyJhbGciOiJQUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmaXh0dXJlIiwiaWF0IjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.WsK5nkf8_mpvcMOD1THCraikXAq8S_yKOm84H3gJsOQK5LPGBJRQk-Q8NBXOlWwvnc_lBERnmxEpXQfUHcxowUT_br0_Ncfgzl8HzP1g1gqurZuYBpvBbkts-zeUmNL9R56aJ7S6H1csdRO_J17Y6n3ybsVGi_kEVv69qc9MG4pnCFX-1cPkaGCF87tT6duivrQ-c5Y_nqRYmntFCNpWvn4M7iMkyDjodY7fQyylbQgCAUmbeJTR2plS6OeovT4wundzsqQsLbRFUX_Hi0zKnhKBFhQ7Bj_F5wch-eIwZF6tzbg_HHD79NMmS87gs4BHDJlkfyg82ia9HvKrO6x6JQ'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T_ES256 =
  'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmaXh0dXJlIiwiaWF0IjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.ZfA5QsjJ7JrvIxRM88F7sSD7YN3oZuNRkb7uyVm5YARWekcvJx2nTN8aPrwmMKzj1cXN1e85IZdO6wEH55fMkQ'; // gitleaks:allow

// A published sample token (the specification's §10), not a credential.
export const T_ES256_DER =
  'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmaXh0dXJlIiwiaWF0IjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.MEQCIEn5YUTZPsUJ_Y3y4NDoMrZf_4MPVAvCvs5tB2iE5_4WAiBNmxNDtUFK-420apV0l8BqaQqPJr6zBbxSLLbkX8Lu9Q'; // gitleaks:allow

// A public test key of the specification.
export const CA_SPKI = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1Laz8hEQjcfLnLj1nBot
7tJrRR1BTWCnWbfZ6RM6pZXzTfgXDjgqpZrqkVOOZSwTNujVJLW4z8OYMxa7jWm9
FmuMq8ZdYZ7QiWuqqKZB5bV03IQwcWDFfpRYzepqiDgLS1rIsxEqJEXUQUvqC8Ne
1MnBaBYmxKHe5nKaMgfQvzl64SuNi78HG8T27SmXonb0DYF8tbuAbkxw3i9M+36S
hLCk0bVqjQ+7TU5fEw+K5om7CnxFZ4y2w79daohWM7rn3MOl9nlTeclvTdvqvHWc
mNVe2YygVfiRBnnS3XYrgOYO0quzzmTWqxGS6my5GpUeNBw6pQmGpsfej/6Kj3Np
iwIDAQAB
-----END PUBLIC KEY-----`;
// A public test key of the specification.
export const CA_PKCS1 = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEA1Laz8hEQjcfLnLj1nBot7tJrRR1BTWCnWbfZ6RM6pZXzTfgXDjgq
pZrqkVOOZSwTNujVJLW4z8OYMxa7jWm9FmuMq8ZdYZ7QiWuqqKZB5bV03IQwcWDF
fpRYzepqiDgLS1rIsxEqJEXUQUvqC8Ne1MnBaBYmxKHe5nKaMgfQvzl64SuNi78H
G8T27SmXonb0DYF8tbuAbkxw3i9M+36ShLCk0bVqjQ+7TU5fEw+K5om7CnxFZ4y2
w79daohWM7rn3MOl9nlTeclvTdvqvHWcmNVe2YygVfiRBnnS3XYrgOYO0quzzmTW
qxGS6my5GpUeNBw6pQmGpsfej/6Kj3NpiwIDAQAB
-----END RSA PUBLIC KEY-----`;
// A published sample key (the specification's §10, a test key).
export const CA_JWK =
  '{"kty":"RSA","n":"1Laz8hEQjcfLnLj1nBot7tJrRR1BTWCnWbfZ6RM6pZXzTfgXDjgqpZrqkVOOZSwTNujVJLW4z8OYMxa7jWm9FmuMq8ZdYZ7QiWuqqKZB5bV03IQwcWDFfpRYzepqiDgLS1rIsxEqJEXUQUvqC8Ne1MnBaBYmxKHe5nKaMgfQvzl64SuNi78HG8T27SmXonb0DYF8tbuAbkxw3i9M-36ShLCk0bVqjQ-7TU5fEw-K5om7CnxFZ4y2w79daohWM7rn3MOl9nlTeclvTdvqvHWcmNVe2YygVfiRBnnS3XYrgOYO0quzzmTWqxGS6my5GpUeNBw6pQmGpsfej_6Kj3Npiw","e":"AQAB"}'; // gitleaks:allow

// A published sample key (the specification's §10, a test key).
export const LEAF_JWK =
  '{"kty":"EC","x":"vo8P50TYF6J14lH8qHIQkvXm84dtPO5rrOzCihYjYIw","y":"pssgKCu6eF8IwRg0l92sb8AtRUWe06YUfkQIaFWmhiw","crv":"P-256"}'; // gitleaks:allow

// The x509 specification's §10 test certificates: "CA" (RSA 2048, valid 2024-01-01 to 2025-01-01), "leaf" (EC P-256)
// and "ed" (Ed25519).
export const CA_CERT = `-----BEGIN CERTIFICATE-----
MIIDMjCCAhqgAwIBAgIBATANBgkqhkiG9w0BAQsFADA5MR8wHQYDVQQDDBZUZXN0
IFJvb3QgQ0EsICJRdW90ZWQiMRYwFAYDVQQKDA1FeGFtcGxlK1Rvb2xzMB4XDTI0
MDEwMTAwMDAwMFoXDTI1MDEwMTAwMDAwMFowOTEfMB0GA1UEAwwWVGVzdCBSb290
IENBLCAiUXVvdGVkIjEWMBQGA1UECgwNRXhhbXBsZStUb29sczCCASIwDQYJKoZI
hvcNAQEBBQADggEPADCCAQoCggEBANS2s/IREI3Hy5y49ZwaLe7Sa0UdQU1gp1m3
2ekTOqWV8034Fw44KqWa6pFTjmUsEzbo1SS1uM/DmDMWu41pvRZrjKvGXWGe0Ilr
qqimQeW1dNyEMHFgxX6UWM3qaog4C0tayLMRKiRF1EFL6gvDXtTJwWgWJsSh3uZy
mjIH0L85euErjYu/BxvE9u0pl6J29A2BfLW7gG5McN4vTPt+koSwpNG1ao0Pu01O
XxMPiuaJuwp8RWeMtsO/XWqIVjO659zDpfZ5U3nJb03b6rx1nJjVXtmMoFX4kQZ5
0t12K4DmDtKrs85k1qsRkupsuRqVHjQcOqUJhqbH3o/+io9zaYsCAwEAAaNFMEMw
EgYDVR0TAQH/BAgwBgEB/wIBADAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFD4+
1X4gFrmGG/5F/JLQ5dAIIPG/MA0GCSqGSIb3DQEBCwUAA4IBAQAudg26KV+RsY6G
xKWdlKjiXk6XQk6ZbiwNY2rgFladbiJcC9+3R7BVtdgKAlCQWXbinZduwMhvGxsG
EU+8wZ2csSnzelW0jwXGF8xAMZZdL7a0NZylQPqYCFrlW6hjDMRzrbUjHUcOjICr
gL+f/nSD/Z4XfK3Q8VrU4qNJ17NEVilOwyP5JNF8OGyu4Q/vrXb44pvKnhLvn2px
qvg9HeRpMesiMhnRjf3H/f68HOuA4i6yKaeko4qCDHb5OaYHtY1cwxEbS8ePLjtL
yhDnV12z5PRTTMrD4SvXa9YUG7B/QM903DxqBeAs/odhkiDpjS0C7Fi5+DOpZtGl
xf8h0gor
-----END CERTIFICATE-----`;

export const LEAF_CERT = `-----BEGIN CERTIFICATE-----
MIICuzCCAmCgAwIBAgIIEjRWeJCrze8wCgYIKoZIzj0EAwIwXDELMAkGA1UEBhMC
REUxGzAZBgNVBAoMEkV4YW1wbGUgVG9vbHMgVGVzdDEVMBMGA1UECwwMQ2VydGlm
aWNhdGVzMRkwFwYDVQQDDBB0ZXN0LmV4YW1wbGUuY29tMCAXDTI1MTExOTEyMDAw
MFoYDzIwNTAwMTAxMDAwMDAwWjBcMQswCQYDVQQGEwJERTEbMBkGA1UECgwSRXhh
bXBsZSBUb29scyBUZXN0MRUwEwYDVQQLDAxDZXJ0aWZpY2F0ZXMxGTAXBgNVBAMM
EHRlc3QuZXhhbXBsZS5jb20wWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAS+jw/n
RNgXonXiUfyochCS9ebzh2087mus7MKKFiNgjKbLICgrunhfCMEYNJfdrG/ALUVF
ntOmFH5ECGhVpoYso4IBCDCCAQQwDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMC
B4AwHQYDVR0lBBYwFAYIKwYBBQUHAwEGCCsGAQUFBwMCMHAGA1UdEQRpMGeCEHRl
c3QuZXhhbXBsZS5jb22CEioudGVzdC5leGFtcGxlLmNvbYcEwAACCocQIAENuAAA
AAAAAAAAAAAAAYERYWRtaW5AZXhhbXBsZS5jb22GFGh0dHBzOi8vZXhhbXBsZS5j
b20vMB0GA1UdDgQWBBTYC1JFVto8vdOkDwzFE9DzTSgbTzAfBgNVHSMEGDAWgBTY
C1JFVto8vdOkDwzFE9DzTSgbTzATBgNVHSAEDDAKMAgGBmeBDAECATAKBggqhkjO
PQQDAgNJADBGAiEA/mZIDMqvFamae4bsMrA6rjU16qYomWqWyzL3cYmuVQcCIQCM
JhKt3UQfbNxjbdg3/DgDjaRcu8ImujxLc6/HORjasQ==
-----END CERTIFICATE-----`;

export const ED_CERT = `-----BEGIN CERTIFICATE-----
MIIBFDCBx6ADAgECAgECMAUGAytlcDAaMRgwFgYDVQQDDA9lZDI1NTE5LmV4YW1w
bGUwHhcNMzAwMTAxMDAwMDAwWhcNMzEwMTAxMDAwMDAwWjAaMRgwFgYDVQQDDA9l
ZDI1NTE5LmV4YW1wbGUwKjAFBgMrZXADIQCzweXAIXxB06Bys8sHFcXubLNHEs0z
S1h6X53BUxvfZKMyMDAwHQYDVR0OBBYEFAQOgTVB6UjCdA7NaIaBeWLsqt+0MA8G
A1UdEwEB/wQFMAMBAf8wBQYDK2VwA0EAq+Yz+WzVk0isqDJp2XTVUkavyKzkZIXU
zCYc1CGPC6jYXqVRX2Xmw45OHk+MRVdAODa6G/WhTs3R6zzOX3qQCA==
-----END CERTIFICATE-----`;
