# Masked-Email Relay

By default, auto-identity-remove submits opt-outs using `config.person.email`.
That hands every broker a fresh real address. A masked/relay email lets each
removal request go out under a per-person alias you control, which you can
disable later if a broker abuses it.

When `config.relay` is set, the tool resolves one alias per person, caches it in
`state.json` under `relayAliases`, and uses it for both form-based and
email-based opt-outs. Without `config.relay`, behavior is unchanged.

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
   forms, no emails, no generic pass. With `"required": true` the run refuses to
   start at all unless a relay is configured. Your real email is never used as a
   fallback.
5. Email-method brokers: the recommended setup is no `email` block at all, so
   those brokers are listed as manual and you handle them by hand. A broker that
   receives an email can see the SMTP account it came from (`email.smtp.user`),
   not just `from`: Gmail and similar providers rewrite `From` to the account
   address, and the account is in the envelope sender and `Return-Path` anyway.
   So only a separate mailbox that is not linked to you is acceptable, used as
   both `user` and `from`. A SimpleLogin reverse-alias does not work as `from`:
   reverse-aliases are recipient addresses for replying to a contact, not
   sender identities. While an alias is in use, email opt-outs and
   right-to-know requests are skipped and listed as manual if `from` is
   missing, or if `from` or `user` is your real address.

## Apple Hide My Email (manual fallback)

Apple has no public alias-creation API, so this is manual:

1. On an Apple device: Settings -> your name -> iCloud -> Hide My Email ->
   Create new address.
2. Label it (e.g. "data-broker opt-outs") and copy the generated
   `@icloud.com` alias.
3. Paste it into `config.person.email` in `config.json`.
4. Leave `config.relay` unset so the tool uses that email directly.

## Firefox Relay (manual fallback)

Firefox Relay's alias API is not integrated here, so this is manual:

1. Sign in at https://relay.firefox.com and create a new mask.
2. Copy the generated `@mozmail.com` alias.
3. Paste it into `config.person.email` in `config.json`.
4. Leave `config.relay` unset.

## Notes

- Aliases are cached per person in `state.json` (`relayAliases` keyed by the
  person's lowercased email). Delete that key to force a fresh alias.
- The alias is used in form email fields, in the email body, and as the
  `Reply-To` on email-method submissions, so broker confirmations route back to
  the alias inbox.
