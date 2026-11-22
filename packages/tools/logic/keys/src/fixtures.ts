/**
 * Published test keys (docs/tools/specs/keys.md §10): RFC 9500 §2 (testRSA1024, testRSA2048, testRSA4096, testECCP256,
 * testECCP384, testECCP521) and RFC 8410 §10.3 (an Ed25519 private key, with and without its public key; the RFC's BER
 * and wrong-length samples). Copied from the RFC texts by a script, line by line. The PEM armour is put together at run
 * time (`pem`), so no line of this file is a whole PEM block; every line of a key is marked for the secret scanner.
 */

/** A PEM block from its label and Base64 lines. */
export const pem = (label: string, lines: readonly string[]): string =>
  [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`, ''].join('\n');

/** RFC 9500 §2: TEST_RSA1024 (RSA PRIVATE KEY). */
export const TEST_RSA1024_LINES: readonly string[] = [
  'MIICXQIBAAKBgQCw0YNSqI9T1VFvRsIOejZ9feiKz1SgGfbe9Xq5tEzt2yJCsbyg', // gitleaks:allow — published test key, RFC 9500
  '+xtcuCswNhdqY5A1ZN7G60HbL4/Hh/TlLhFJ4zNHVylz9mDDx3yp4IIcK2lb566d', // gitleaks:allow — published test key, RFC 9500
  'fTD0B5EQ9Iqub4twLUdLKQCBfyhmJJvsEqKxm4J4QWgI+Brh/Pm3d4piPwIDAQAB', // gitleaks:allow — published test key, RFC 9500
  'AoGASC6fj6TkLfMNdYHLQqG9kOlPfys4fstarpZD7X+fUBJ/H/7y5DzeZLGCYAIU', // gitleaks:allow — published test key, RFC 9500
  '+QeAHWv6TfZIQjReW7Qy00RFJdgwFlTFRCsKXhG5x+IB+jL0Grr08KbgPPDgy4Jm', // gitleaks:allow — published test key, RFC 9500
  'xirRHZVtU8lGbkiZX+omDIU28EHLNWL6rFEcTWao/tERspECQQDp2G5Nw0qYWn7H', // gitleaks:allow — published test key, RFC 9500
  'Wm9Up1zkUTnkUkCzhqtxHbeRvNmHGKE7ryGMJEk2RmgHVstQpsvuFY4lIUSZEjAc', // gitleaks:allow — published test key, RFC 9500
  'DUFJERhFAkEAwZH6O1ULORp8sHKDdidyleYcZU8L7y9Y3OXJYqELfddfBgFUZeVQ', // gitleaks:allow — published test key, RFC 9500
  'duRmJj7ryu0g0uurOTE+i8VnMg/ostxiswJBAOc64Dd8uLJWKa6uug+XPr91oi0n', // gitleaks:allow — published test key, RFC 9500
  'OFtM+xHrNK2jc+WmcSg3UJDnAI3uqMc5B+pERLq0Dc6hStehqHjUko3RnZECQEGZ', // gitleaks:allow — published test key, RFC 9500
  'eRYWciE+Cre5dzfZkomeXE0xBrhecV0bOq6EKWLSVE+yr6mAl05ThRK9DCfPSOpy', // gitleaks:allow — published test key, RFC 9500
  'F6rgN3QiyCA9J/1FluUCQQC5nX+PTU1FXx+6Ri2ZCi6EjEKMHr7gHcABhMinZYOt', // gitleaks:allow — published test key, RFC 9500
  'N59pra9UdVQw9jxCU9G7eMyb0jJkNACAuEwakX3gi27b', // gitleaks:allow — published test key, RFC 9500
];
export const TEST_RSA1024 = pem('RSA PRIVATE KEY', TEST_RSA1024_LINES);

/** RFC 9500 §2: TEST_RSA2048 (RSA PRIVATE KEY). */
export const TEST_RSA2048_LINES: readonly string[] = [
  'MIIEowIBAAKCAQEAsPnoGUOnrpiSqt4XynxA+HRP7S+BSObI6qJ7fQAVSPtRkqso', // gitleaks:allow — published test key, RFC 9500
  'tWxQYLEYzNEx5ZSHTGypibVsJylvCfuToDTfMul8b/CZjP2Ob0LdpYrNH6l5hvFE', // gitleaks:allow — published test key, RFC 9500
  '89FU1nZQF15oVLOpUgA7wGiHuEVawrGfey92UE68mOyUVXGweJIVDdxqdMoPvNNU', // gitleaks:allow — published test key, RFC 9500
  'l86BU02vlBiESxOuox+dWmuVV7vfYZ79Toh/LUK43YvJh+rhv4nKuF7iHjVjBd9s', // gitleaks:allow — published test key, RFC 9500
  'B6iDjj70HFldzOQ9r8SRI+9NirupPTkF5AKNe6kUhKJ1luB7S27ZkvB3tSTT3P59', // gitleaks:allow — published test key, RFC 9500
  '3VVJvnzOjaA1z6Cz+4+eRvcysqhrRgFlwI9TEwIDAQABAoIBAEEYiyDP29vCzx/+', // gitleaks:allow — published test key, RFC 9500
  'dS3LqnI5BjUuJhXUnc6AWX/PCgVAO+8A+gZRgvct7PtZb0sM6P9ZcLrweomlGezI', // gitleaks:allow — published test key, RFC 9500
  'FrL0/6xQaa8bBr/ve/a8155OgcjFo6fZEw3Dz7ra5fbSiPmu4/b/kvrg+Br1l77J', // gitleaks:allow — published test key, RFC 9500
  'aun6uUAs1f5B9wW+vbR7tzbT/mxaUeDiBzKpe15GwcvbJtdIVMa2YErtRjc1/5B2', // gitleaks:allow — published test key, RFC 9500
  'BGVXyvlJv0SIlcIEMsHgnAFOp1ZgQ08aDzvilLq8XVMOahAhP1O2A3X8hKdXPyrx', // gitleaks:allow — published test key, RFC 9500
  'IVWE9bS9ptTo+eF6eNl+d7htpKGEZHUxinoQpWEBTv+iOoHsVunkEJ3vjLP3lyI/', // gitleaks:allow — published test key, RFC 9500
  'fY0NQ1ECgYEA3RBXAjgvIys2gfU3keImF8e/TprLge1I2vbWmV2j6rZCg5r/AS0u', // gitleaks:allow — published test key, RFC 9500
  'pii5CvJ5/T5vfJPNgPBy8B/yRDs+6PJO1GmnlhOkG9JAIPkv0RBZvR0PMBtbp6nT', // gitleaks:allow — published test key, RFC 9500
  'Y3yo1lwamBVBfY6rc0sLTzosZh2aGoLzrHNMQFMGaauORzBFpY5lU50CgYEAzPHl', // gitleaks:allow — published test key, RFC 9500
  'u5DI6Xgep1vr8QvCUuEesCOgJg8Yh1UqVoY/SmQh6MYAv1I9bLGwrb3WW/7kqIoD', // gitleaks:allow — published test key, RFC 9500
  'fj0aQV5buVZI2loMomtU9KY5SFIsPV+JuUpy7/+VE01ZQM5FdY8wiYCQiVZYju9X', // gitleaks:allow — published test key, RFC 9500
  'Wz5LxMNoz+gT7pwlLCsC4N+R8aoBk404aF1gum8CgYAJ7VTq7Zj4TFV7Soa/T1eE', // gitleaks:allow — published test key, RFC 9500
  'k9y8a+kdoYk3BASpCHJ29M5R2KEA7YV9wrBklHTz8VzSTFTbKHEQ5W5csAhoL5Fo', // gitleaks:allow — published test key, RFC 9500
  'qoHzFFi3Qx7MHESQb9qHyolHEMNx6QdsHUn7rlEnaTTyrXh3ifQtD6C0yTmFXUIS', // gitleaks:allow — published test key, RFC 9500
  'CW9wKApOrnyKJ9nI0HcuZQKBgQCMtoV6e9VGX4AEfpuHvAAnMYQFgeBiYTkBKltQ', // gitleaks:allow — published test key, RFC 9500
  'XwozhH63uMMomUmtSG87Sz1TmrXadjAhy8gsG6I0pWaN7QgBuFnzQ/HOkwTm+qKw', // gitleaks:allow — published test key, RFC 9500
  'AsrZt4zeXNwsH7QXHEJCFnCmqw9QzEoZTrNtHJHpNboBuVnYcoueZEJrP8OnUG3r', // gitleaks:allow — published test key, RFC 9500
  'UjmopwKBgAqB2KYYMUqAOvYcBnEfLDmyZv9BTVNHbR2lKkMYqv5LlvDaBxVfilE0', // gitleaks:allow — published test key, RFC 9500
  '2riO4p6BaAdvzXjKeRrGNEKoHNBpOSfYCOM16NjL8hIZB1CaV3WbT5oY+jp7Mzd5', // gitleaks:allow — published test key, RFC 9500
  '7d56RZOE+ERK2uz/7JX9VSsM/LbH9pJibd4e8mikDS9ntciqOH/3', // gitleaks:allow — published test key, RFC 9500
];
export const TEST_RSA2048 = pem('RSA PRIVATE KEY', TEST_RSA2048_LINES);

/** RFC 9500 §2: TEST_RSA4096 (RSA PRIVATE KEY). */
export const TEST_RSA4096_LINES: readonly string[] = [
  'MIIJKAIBAAKCAgEAs4tJYOY75qjbqJqCl47x9jJE5Vd9jPWGFtXKV1nUnMjZNsM4', // gitleaks:allow — published test key, RFC 9500
  'qjy5sRHBSX5bUa9pLyYR5on3Z1SAwLD0w2VPQ6+F/oyK1zTgQqitoF/XZQjgC6D3', // gitleaks:allow — published test key, RFC 9500
  'VsNEO76DPqfRANT7Nn7r1gvbZIZ3/H3rlCRNrRr47tHGWBLAPnxz9/NY6UG8ZkWP', // gitleaks:allow — published test key, RFC 9500
  '97uXpJqYoRgH4CwaO5rTOlc64YDh/0Mq5VgMycq/q2AvMlvNoJfoe8em1040qH1g', // gitleaks:allow — published test key, RFC 9500
  'ikP+suT/8fS452hqmEddtRpuvQgXKldBd0kkiyFVyLkG4NVA6Mso9MAK3J/kdYoa', // gitleaks:allow — published test key, RFC 9500
  'w2SrOeThVSiYVEQVP+7GrUxTSLLjj/VQ9fpYM5eTNzDICIG/Ee7o/jhtW1EoSamD', // gitleaks:allow — published test key, RFC 9500
  'mUOr89lyIHaXuOwkEaJhnVXKBCM8WiztxvKG2CnQ6Dcge3ZSmqJEhyEmjcAVC7ew', // gitleaks:allow — published test key, RFC 9500
  'fnMxOnE+WJW6rzrf+mA5WMVn+FzyWx2AondWow0aUKHkaY7amhIrsKp6YPfNImyx', // gitleaks:allow — published test key, RFC 9500
  'Flz8+cqDCmBswPsUh/JJ5eDHHIhibFcSgIHedsEjhLbUSLZ/DnEjru90qIWWA3R1', // gitleaks:allow — published test key, RFC 9500
  'VIPykKfeZkZeInsrFzGPikkFKwFF+6KDdyvCmltYEqzO46tigXAZ5UgH8oiXEre4', // gitleaks:allow — published test key, RFC 9500
  '8wO6X+FH+cLzQ0q3A8HZRnNDgqCjU/Tgy76iaku/Ic6eteedR1fX3gJ/IOUCAwEA', // gitleaks:allow — published test key, RFC 9500
  'AQKCAgBq0bC7fN8gkU/2lM6jewFL14aT6CSjS6QWS+XRaHmNOhW5dhZteimERqr3', // gitleaks:allow — published test key, RFC 9500
  'nbyY8cKjsYOu5GCUUnszqVRGOC0beP9Afb9Q4H2YSyDZrIvK6afaY08kiJI89VDC', // gitleaks:allow — published test key, RFC 9500
  'Yzd+xjgbqRGIzI8f1LzoNMaG4b5xAf4eoCHgXm+P/Z1FZLt+M4TyV+qamjpTTUMH', // gitleaks:allow — published test key, RFC 9500
  'fPOalMKaubd4G1PFvFc49m47+tHI8N5uCJCr5mCFbjt8AUGrETVVFRrtyBxttL7t', // gitleaks:allow — published test key, RFC 9500
  '5gpoawAYT0VaLTq7LmgR4c3qOVMLj66o+CQ2ecnfdpeMXgFYV6ylnZ/kpi0VCa5i', // gitleaks:allow — published test key, RFC 9500
  'av+OCt+VpOsBScq3Eu8+w9YCMopsUCG6GzW4WD2akEBVA/X6D0JMcoYj/IHT3Xv/', // gitleaks:allow — published test key, RFC 9500
  'G/eMji69A6URLetliZhuSb0wBxrYQaPMqAdsz8eUYzCx/RwhKtPr032aTQqWlbgW', // gitleaks:allow — published test key, RFC 9500
  'igiJMn1SbxbRVjf6nb8EsLg92LXEBS3FOLbK6ckuyXAQei8e5NR6ZcyluVluQnSR', // gitleaks:allow — published test key, RFC 9500
  'm+fR7JDkUP5YWNwuAehOvZIH2Oog+jcUDonQENZQHyJhlxgE3nNoD+YcI1yPTmMf', // gitleaks:allow — published test key, RFC 9500
  '8G297mZtu5r7/aO5ccMpDXve9cV4Wgcb6Urhigsu2K5nmrqmEIUoqF4xf4eomcWJ', // gitleaks:allow — published test key, RFC 9500
  '9KitQpCmyh758U2NCnpm3HULabGcslgow+rwQiFcCarUqVToVQKCAQEA4EG98cm1', // gitleaks:allow — published test key, RFC 9500
  'aaz16AItIRuHG18pIUGlif0PbctZR2scHaQBjdeh4Qg5MnRe88Zs9/8xPu1MsWgd', // gitleaks:allow — published test key, RFC 9500
  '750pzD/oevetGenvNFZiycT05ucHqk6ZSWNMCGRxpVtnRsKu74dx7yGi7oq03sTC', // gitleaks:allow — published test key, RFC 9500
  'BDxwz7qJ5esvYuoHx0vUFmdpEqlYn7PtcCiPigPRkcWKiJbosg8e3pGAztMDWfdf', // gitleaks:allow — published test key, RFC 9500
  'SK/pfEbuWcknHnE3VUrXBVYXhI/TBBzWMEf2RiwOZuGDn2PGEtSjV/XldjVqqufG', // gitleaks:allow — published test key, RFC 9500
  'SsC/2dZe30svNNrb32kGIMiVykTZYdoFsTYrStXarLkP9YYzXs1+HXoWAMsas3Jp', // gitleaks:allow — published test key, RFC 9500
  'W27HcXYh276TVwKCAQEAzPVRKdO5JMg4p2zTadRunLgT/js5uvHrEBhH0x0JE1AD', // gitleaks:allow — published test key, RFC 9500
  'qy/COUMc2m6ZCIg96KBUbjUoN9TrlctB2O7BSmbNOMIkfoKjlDkpJ7v1cKhlXg8q', // gitleaks:allow — published test key, RFC 9500
  'wkPl+4dv0gtIdnOidy2pcMHfR6Mt6op15wlUcyKcaTyIajFtLOy/A1l7BMqeyr2j', // gitleaks:allow — published test key, RFC 9500
  'Nm4HZIgFmyRZb1326FaX2+YqsvjMcax/dDtkEm0B8rNhJxbsp2l15RTtTXijIpC+', // gitleaks:allow — published test key, RFC 9500
  'CoLxRBSZK9GAPa3Jg93ydtLK4aCpA/keeL48C8r1jzzpjRI6pshfZVHFcAf+R3rI', // gitleaks:allow — published test key, RFC 9500
  'fgOLmpSsxiDeEiWBBTRKDPs3ZVBejn7IasCG9lVkIwKCAQAvfBwxN2nPb40+TD+s', // gitleaks:allow — published test key, RFC 9500
  'E/0ewZ6e6RyZRFlhAT7tTXPNnu2pUDB5ytj5owR8D9cBCCswTOUBZ693DktMcXfT', // gitleaks:allow — published test key, RFC 9500
  'meAwbYV2CpiuaqMExYSs/imdDYaK/GHIBruukwihtYddgDzUz9AOn5EJfpbQlYof', // gitleaks:allow — published test key, RFC 9500
  'ghYtlqqA+8Bz4f+wsOUQI/Qx3JTQP5C/khmMZI/vLB54OE0S/kFmamflp0IES6yq', // gitleaks:allow — published test key, RFC 9500
  'nFpJKuXxjIBNI/ak3iNraoO8A3DVWPzPsg7B0EmfsSDJPksRJaxpddxZ9chp4ueB', // gitleaks:allow — published test key, RFC 9500
  '1pSvV2xZOQ7QIEj/ZGa3PogYBwVRukisbB9B+OGlwFNlAHXqQxdrSd2fO6zFjKMM', // gitleaks:allow — published test key, RFC 9500
  'uaTPAoIBAFdahwkor9Q5ccwJ2eFVJP+uhPbqDyTaTrFBZ/tWeLO+epHPfRwiun1u', // gitleaks:allow — published test key, RFC 9500
  'fdLhHmGzU8jU5xtEqFPjmWD4AXHQds8mD5/L1iQqaJwCxA0L+IgqNrMtdSvLAaGo', // gitleaks:allow — published test key, RFC 9500
  'JW42wpvA3mKsfplttvgroyyhEVkw+zDvF8UK49kt3gtza7cTFLKcOJ/OLWBviNQi', // gitleaks:allow — published test key, RFC 9500
  'neuVRNKpdXfHlZNJ7vjT6E6FsZUY2Ke0REgAwURo8lJ8pNdL/1uQDS81t9aoYNAI', // gitleaks:allow — published test key, RFC 9500
  'LnwbQbPuOJTkKowXiXGkD5Sun7D3A8nU0EXL6yuCYwYv39Jr1bhpYGI06J8tlqWr', // gitleaks:allow — published test key, RFC 9500
  'BHr/eQnay2TU/Ts1EdfxuUGmZN9AbbkCggEBANEMkY2p8m2pTf87CSQ8jMPUOQJt', // gitleaks:allow — published test key, RFC 9500
  '5iuenzesYLvXqVLLB4SUvXN+zDplDJPELtf2SQIHrplrPNH/H01jnWHd0ecSjVY8', // gitleaks:allow — published test key, RFC 9500
  'HBbIs52U1d5ek3/mWji4GeRp+Iw84CUh4q2p40bmob1RJ8e9sh2ixhHjX2yJ591m', // gitleaks:allow — published test key, RFC 9500
  'oGbLIz75a60a05mUDK0FWt9cWHn4MKgIPKbWwFhYwmYDCjO/tK2DtcySny9soh5Q', // gitleaks:allow — published test key, RFC 9500
  'KVQriuvna2lE4YY+OUc7btmtkmp9v+LHKOI8dPabsOBU8Z8UbOGeHSNrZTQwpx3E', // gitleaks:allow — published test key, RFC 9500
  'p0riDg0UEzFmoYrfbvf+2VzEZDX/TJYjK9VkA8w5+xat8iS0/euKuvSRMb8=', // gitleaks:allow — published test key, RFC 9500
];
export const TEST_RSA4096 = pem('RSA PRIVATE KEY', TEST_RSA4096_LINES);

/** RFC 9500 §2: TEST_ECC_P256 (EC PRIVATE KEY). */
export const TEST_ECC_P256_LINES: readonly string[] = [
  'MHcCAQEEIObLW92AqkWunJXowVR2Z5/+yVPBaFHnEedDk5WJxk/BoAoGCCqGSM49', // gitleaks:allow — published test key, RFC 9500
  'AwEHoUQDQgAEQiVI+I+3gv+17KN0RFLHKh5Vj71vc75eSOkyMsxFxbFsTNEMTLjV', // gitleaks:allow — published test key, RFC 9500
  'uKFxOelIgsiZJXKZNCX0FBmrfpCkKklCcg==', // gitleaks:allow — published test key, RFC 9500
];
export const TEST_ECC_P256 = pem('EC PRIVATE KEY', TEST_ECC_P256_LINES);

/** RFC 9500 §2: TEST_ECC_P384 (EC PRIVATE KEY). */
export const TEST_ECC_P384_LINES: readonly string[] = [
  'MIGkAgEBBDDiVjMo36v2gYhga5EyQoHB1YpEVkMbCdUQs1/syfMHyhgihG+iZxNx', // gitleaks:allow — published test key, RFC 9500
  'qagbrA41dJ2gBwYFK4EEACKhZANiAARbCQG4hSMpbrkZ1Q/6GpyzdLxNQJWGKCv+', // gitleaks:allow — published test key, RFC 9500
  'yhGx2VrbtUc0r1cL+CtyKM8ia89MJd28/jsaOtOUMO/3Y+HWjS4VHZFyC3eVtY2m', // gitleaks:allow — published test key, RFC 9500
  's0Y5YTqPubWo2kjGdHEX+ZGehCTzfsg=', // gitleaks:allow — published test key, RFC 9500
];
export const TEST_ECC_P384 = pem('EC PRIVATE KEY', TEST_ECC_P384_LINES);

/** RFC 9500 §2: TEST_ECC_P521 (EC PRIVATE KEY). */
export const TEST_ECC_P521_LINES: readonly string[] = [
  'MIHcAgEBBEIB2STcygqIf42Zdno32HTmN6Esy0d9bghmU1ZpTWi3ZV5QaWOP3ntF', // gitleaks:allow — published test key, RFC 9500
  'yFQBPcd6NbGGVbhMlmpgIg1A+R7Z9RRYAuqgBwYFK4EEACOhgYkDgYYABAHQ/XJX', // gitleaks:allow — published test key, RFC 9500
  'qEx0f1YldcBzhdvr8vUr6lgIPbgv3RUx2KrjzIdf8C/3+i2iYNjrYtbS9dZJJ44y', // gitleaks:allow — published test key, RFC 9500
  'FzagYoy7swMItuYY2wD2KtIExkYDWbyBiriWG/Dw/A7FquikKBc85W8A3psVfB5c', // gitleaks:allow — published test key, RFC 9500
  'gsZPVi/K3vxKTCj200LPPvYW/ILTO3KFySHyvzb92A==', // gitleaks:allow — published test key, RFC 9500
];
export const TEST_ECC_P521 = pem('EC PRIVATE KEY', TEST_ECC_P521_LINES);

/** RFC 8410 §10.3: the Ed25519 private key without its public key. */
export const ED25519_V1_LINES: readonly string[] = [
  'MC4CAQAwBQYDK2VwBCIEINTuctv5E1hK1bbY8fdp+K06/nwoy/HU++CXqI9EdVhC', // gitleaks:allow — published test key, RFC 8410
];
export const ED25519_V1 = pem('PRIVATE KEY', ED25519_V1_LINES);

/** RFC 8410 §10.3: the same key with an attribute and its public key (OneAsymmetricKey v2). */
export const ED25519_V2_LINES: readonly string[] = [
  'MHICAQEwBQYDK2VwBCIEINTuctv5E1hK1bbY8fdp+K06/nwoy/HU++CXqI9EdVhC', // gitleaks:allow — published test key, RFC 8410
  'oB8wHQYKKoZIhvcNAQkJFDEPDA1DdXJkbGUgQ2hhaXJzgSEAGb9ECWmEzf6FQbrB', // gitleaks:allow — published test key, RFC 8410
  'Z9w7lshQhqowtrbLDFw4rXAxZuE=', // gitleaks:allow — published test key, RFC 8410
];
export const ED25519_V2 = pem('PRIVATE KEY', ED25519_V2_LINES);

/** RFC 8410 §10.3: the same key in BER (indefinite lengths), which a DER reader refuses. */
export const ED25519_BER_LINES: readonly string[] = [
  'MIACAQAwgAYDK2VwAAAEIgQg1O5y2/kTWErVttjx92n4rTr+fCjL8dT74Jeoj0R1W', // gitleaks:allow — published test key, RFC 8410
  'EIAAA==', // gitleaks:allow — published test key, RFC 8410
];
export const ED25519_BER = pem('PRIVATE KEY', ED25519_BER_LINES);

/** RFC 8410 §10.3: a key of the wrong length (the first byte, zero, removed). */
export const ED25519_SHORT_FIRST_LINES: readonly string[] = [
  'MFICAQEwBQYDK2VwBCIEIC3GfeUYbZGTAhwLEE2cbvJL7ivTlcy17VottfN6L8HwoS', // gitleaks:allow — published test key, RFC 8410
  'IDIADBfk2Lv/J8H7YYwj/OmIcDx++jzVkKrKwS0/HjyQyM', // gitleaks:allow — published test key, RFC 8410
];
export const ED25519_SHORT_FIRST = pem('PRIVATE KEY', ED25519_SHORT_FIRST_LINES);

/** RFC 8410 §10.3: a key of the wrong length (the last byte, zero, removed). */
export const ED25519_SHORT_LAST_LINES: readonly string[] = [
  'MFICAQEwBQYDK2VwBCIEILJXn1VaLqvausjUaZexwI/ozmOFjfEk78KcYN+7hsNJoS', // gitleaks:allow — published test key, RFC 8410
  'IDIACdQhJwzi/MCGcsQeQnIUh2JFybDxSrZxuLudJmpJLk', // gitleaks:allow — published test key, RFC 8410
];
export const ED25519_SHORT_LAST = pem('PRIVATE KEY', ED25519_SHORT_LAST_LINES);

/** RFC 8410 §10.3: §4, the public key of ED25519_V1. */
export const ED25519_SPKI_LINES: readonly string[] = [
  'MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=', // gitleaks:allow — published test key, RFC 8410
];
export const ED25519_SPKI = pem('PUBLIC KEY', ED25519_SPKI_LINES);
