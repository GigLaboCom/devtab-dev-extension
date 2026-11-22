// Every command of docs/tools/specs/curl-to-code.md §10 in every client: the code and the warnings, kept in
// __snapshots__/samples.test.ts.snap (reviewed when it changes), with the contract of clients.test.ts checked on each.
// The §10 sample command — POST with a JSON body — is written out in full for the clients added on 2026-11-22 (the
// first four are logic.test.ts's), as the specification shows it.
import { ALL_TARGETS, convert, ready } from './testing';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Target } from './types';

beforeAll(ready);

const COMMANDS = [
  'curl https://api.example.com/users',
  `curl -X POST https://api.example.com/items -H 'Content-Type: application/json' -d '{"name":"pen","qty":2}'`,
  "curl 'https://api.example.com/items' --data 'a=1' --data 'b=2'",
  "curl -G https://api.example.com/search --data-urlencode 'q=hello world&more' -d lang=en",
  "curl --data-urlencode 'a b' --data-urlencode '=c&d' --data-urlencode 'e=ü/?' https://api.example.com/f",
  "curl -u 'ann:pa:ss' https://api.example.com/me",
  "curl -F name=Ann -F 'note=a b' https://api.example.com/form",
  `curl --json '{"a":1}' https://api.example.com/x`,
  `curl 'https://api.example.com/api' \\\n  -H 'accept: */*' \\\n  -b 'sid=abc; theme=dark' \\\n  --data-raw $'{"text":"line1\\\\nline2 é it\\'s"}'`,
  'curl ^"https://api.example.com/api?q=1^&x=2^" ^\n  -H ^"accept: application/json^" ^\n  --data-raw ^"^{^\\^"a^\\^":1^}^"',
  "curl -sSL -XPUT -H'X-Trace: 1' https://api.example.com/put -d 'x=1'",
  'curl -k -m 2.5 --compressed https://api.example.com/slow',
  'curl -s https://api.example.com/users | jq .',
  'curl "https://api.example.com/users/$ID" -H "Authorization: Bearer $TOKEN"',
  "curl -H 'Authorization: Bearer t0k' -u a:b https://api.example.com/me",
  'curl -X PURGE https://api.example.com/cache',
  'curl api.example.com/plain',
  'curl -d @body.json https://api.example.com/upload',
  "curl -d 'name=Jörg 🙂' https://api.example.com/n",
  "curl -H 'X-Empty;' -H 'Accept:' https://api.example.com/h",
  'curl -I https://api.example.com/',
  "curl -A 'probe' -e https://ref.example/ -b 'a=1' -b 'b=2' https://api.example.com/c",
  "curl -H 'X-A: 1' -H 'x-a: 2' https://api.example.com/r",
  'curl "https://api.example.com/q" -H "X-Note: say \\"hi\\" \\$5" -d "v=\\`x\\`"',
  'curl --oauth2-bearer abc123 https://api.example.com/o',
  'curl https://api.example.com/c2 # fetch it',
  'curl --frobnicate --proxy http://p:1 https://api.example.com/u',
  // Added with the clients of 2026-11-22: files, redirects, a form with a file, a header that is not ASCII.
  "curl -L -T upload.txt -H 'X-Name: Jörg' https://api.example.com/up/",
  "curl -F 'photo=@photo.png' -F n=1 https://api.example.com/form",
];

describe('§10 commands in every client', () => {
  it.each(ALL_TARGETS)('%s', target => {
    const out = COMMANDS.map(command => {
      const r = convert(command, target);
      if (!r.ok) throw new Error(`${command}: ${r.error.message}`);
      expect(r.text.endsWith('\n') && !r.text.endsWith('\n\n')).toBe(true);
      return `$ ${command}\n${r.text}${r.warnings.map(w => `! ${w}\n`).join('')}`;
    });
    expect(out.join('\n')).toMatchSnapshot();
  });
});

const ITEMS = COMMANDS[1]!;

const SAMPLES: Partial<Record<Target, string>> = {
  node: `const response = await fetch('https://api.example.com/items', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: '{"name":"pen","qty":2}'
});
console.log(await response.text());
`,
  axios: `// npm install axios
~import axios from 'axios';

const response = await axios({
  method: 'POST',
  url: 'https://api.example.com/items',
  headers: {
    'Content-Type': 'application/json'
  },
  data: '{"name":"pen","qty":2}'
});
console.log(response.data);
`,
  'http-client': `import http.client

body = '{"name":"pen","qty":2}'

headers = {
    'Content-Type': 'application/json',
}

conn = http.client.HTTPSConnection('api.example.com')
conn.request('POST', '/items', body=body, headers=headers)
response = conn.getresponse()
print(response.read().decode())
`,
  httpie: `http POST 'https://api.example.com/items' \\
  'Content-Type:application/json' \\
  --raw '{"name":"pen","qty":2}'
`,
  wget: `wget --quiet --output-document=- \\
  --method=POST \\
  --header 'Content-Type: application/json' \\
  --body-data '{"name":"pen","qty":2}' \\
  'https://api.example.com/items'
`,
  java: `// Java 11 or later: java Main.java

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder(URI.create("https://api.example.com/items"))
            .POST(HttpRequest.BodyPublishers.ofString("{\\"name\\":\\"pen\\",\\"qty\\":2}"))
            .header("Content-Type", "application/json")
            .build();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}
`,
  csharp: `// .NET 6 or later: a top-level program.
using System;
using System.Net.Http;
using System.Text;

using var client = new HttpClient();
using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.example.com/items");
request.Content = new ByteArrayContent(Encoding.UTF8.GetBytes("{\\"name\\":\\"pen\\",\\"qty\\":2}"));
request.Content.Headers.TryAddWithoutValidation("Content-Type", "application/json");

using var response = await client.SendAsync(request);
Console.WriteLine(await response.Content.ReadAsStringAsync());
`,
  php: `<?php

$ch = curl_init('https://api.example.com/items');
curl_setopt_array($ch, [
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => '{"name":"pen","qty":2}',
    CURLOPT_RETURNTRANSFER => true,
]);
$response = curl_exec($ch);
if ($response === false) {
    throw new RuntimeException(curl_error($ch));
}
curl_close($ch);
echo $response;
`,
  powershell: `# PowerShell 7 or later
$params = @{
    Uri = 'https://api.example.com/items'
    Method = 'Post'
    Headers = @{
        'Content-Type' = 'application/json'
    }
    Body = '{"name":"pen","qty":2}'
    SkipHeaderValidation = $true
}
$response = Invoke-WebRequest @params
$response.Content
`,
  kotlin: `// build.gradle.kts: implementation("com.squareup.okhttp3:okhttp:4.12.0")

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

fun main() {
    val client = OkHttpClient()
    val request = Request.Builder()
        .url("https://api.example.com/items")
        .post("{\\"name\\":\\"pen\\",\\"qty\\":2}".toRequestBody())
        .addHeader("Content-Type", "application/json")
        .build()
    client.newCall(request).execute().use { response ->
        println(response.body?.string())
    }
}
`,
  dart: `// pubspec.yaml: dependencies: { http: ^1.2.0 }
~import 'dart:convert';
~import 'package:http/http.dart' as http;

Future<void> main() async {
  final request = http.Request('POST', Uri.parse('https://api.example.com/items'));
  request.headers.addAll({
    'Content-Type': 'application/json',
  });
  request.bodyBytes = utf8.encode('{"name":"pen","qty":2}');
  final response = await request.send().then(http.Response.fromStream);
  print(response.body);
}
`,
  ruby: `require 'net/http'

uri = URI('https://api.example.com/items')
request = Net::HTTP::Post.new(uri)
request['Content-Type'] = 'application/json'
request.body = '{"name":"pen","qty":2}'

response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == 'https') do |http|
  http.request(request)
end
puts response.body
`,
  swift: `import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

var request = URLRequest(url: URL(string: "https://api.example.com/items")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = Data("{\\"name\\":\\"pen\\",\\"qty\\":2}".utf8)

let (data, _) = try await URLSession.shared.data(for: request)
print(String(decoding: data, as: UTF8.self))
`,
};

// An import line of an expected program is written `~import`, so the extension's shape test, which reads this file's
// own imports line by line, does not take it for one.
describe('§10 sample (POST with a JSON body) in the clients added on 2026-11-22, in full', () => {
  it.each(Object.entries(SAMPLES))('%s', (target, text) => {
    expect(convert(ITEMS, target as Target)).toEqual({
      ok: true,
      text: text.replace(/^~import/gm, 'import'),
      warnings: [],
      hasCredentials: false,
    });
  });
});
