# Masked-Email Relay

By default, upec-wipe submits nothing without a working relay: a person with
no alias is blocked, never given `config.person.email`. A masked/relay email
lets each removal request go out under a per-person alias you control, which
you can disable later if a broker abuses it.

When `config.relay` is set, the tool resolves one alias per person, caches it in
`state.json` under `relayAliases`, and puts it in every form's email field.
Without a working relay, nothing is submitted. Only `"required": false` in the
`relay` block lets forms get your real email instead. Email requests
(`run --email`) do not use the alias: they come from your dedicated mailbox.

## SimpleLogin (automated, via API)

1. Create a SimpleLogin account at https://simplelogin.io and verify it.
2. Generate an API key: Account Settings -> API Keys -> Create.
3. Add to `config.json`:

   ```json
   "relay": {
     "provider": "simplelogin",
     "apiKey": "YOUR_SIMPLELOGIN_API_KEY",
     "required": true
   }
   ```

4. Run the tool normally. On the first run per person it POSTs to
   `https://app.simplelogin.io/api/alias/random/new?mode=word` (header
   `Authentication: <apiKey>`) and caches the returned alias in `state.json`.
   **If the API call fails, that person gets no submissions this run** - no
   forms, no emails. With no usable
   relay configured (or the placeholder key still in place), every person is
   blocked and the run exits non-zero with no submissions. This is the default;
   only `"required": false` sends your real email instead.
5. Email-method brokers: they are sent only by `upec-wipe run --email` (see the
   manual, "Email requests"). A broker that receives an email can see the SMTP
   account it came from (`email.smtp.user`), not just `from`, so use a separate
   mailbox that is not linked to you, as both `email.smtp.user` and
   `email.smtp.from`; the email step refuses to run when the two differ or when
   either is your real address. A SimpleLogin reverse-alias does not work as
   `from`: reverse-aliases are recipient addresses for replying to a contact,
   not sender identities.

## Apple Hide My Email (manual fallback)

Apple has no public alias-creation API, so this is manual:

1. On an Apple device: Settings -> your name -> iCloud -> Hide My Email ->
   Create new address.
2. Label it (e.g. "data-broker opt-outs") and copy the generated
   `@icloud.com` alias.
3. Paste it into `config.person.email` in `config.json`.
4. Set `"relay": { "required": false }` so the tool uses that email directly
   (with no relay at all, nothing is submitted).

## Firefox Relay (manual fallback)

Firefox Relay's alias API is not integrated here, so this is manual:

1. Sign in at https://relay.firefox.com and create a new mask.
2. Copy the generated `@mozmail.com` alias.
3. Paste it into `config.person.email` in `config.json`.
4. Set `"relay": { "required": false }`, as for Apple above.

## Notes

- Aliases are cached per person in `state.json` (`relayAliases` keyed by the
  person's lowercased email). Delete that key to force a fresh alias.
- The alias is used in form email fields, so broker confirmations from forms
  route back to the alias inbox. Email requests use the dedicated mailbox as
  both `From` and `Reply-To`, so their replies arrive there.
