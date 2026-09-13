# Vizonator

Browser extension Vizonator include wallet for [VIZ blockchain](https://github.com/VIZ-Blockchain/viz-cpp-node) and web3 provider included as content script to active tab.

![Vizonator UX Example](screenshot/en/4.png)

# Features

* Multi-account
* Wallet (history, transfer, stacking, unstacking, award)
* Rule-based trustline system for separate sites
* All data settings encoding by user password (AES-GCM: AES with Galois/Counter Mode)
* [Web3 Provider](https://viz.world/vizonator/docs/) like Metamask (`vizonator` global variable for js integrations)
* Integration with [Voice protocol](https://github.com/VIZ-Blockchain/Free-Speech-Project/blob/master/specification.md) (send post to account social feed)
* Integration with social gate `@social` ([read more about social gates](https://viz.world/social-gateways/))
* All [prediction market](https://viz-blockchain.github.io/viz-cpp-node/prediction-markets/) operations available to dApps (see below)
* Dark-mode theme & Turbo cat as easter egg character

Social gate integration included as additional tool for easy way to reward content creators:

* Twitch.tv
* YouTube.com
* SoundCloud.com
* BitcoinTalk.org
* Github.com
* Reddit.com
* Twitter.com

> Some social gates can be disabled due API or site parsing restrictions.

## Prediction market operations

All 23 broadcastable `pm_*` operations of the HF14 (Onix) hardfork are exposed to the page as
methods of the `vizonator` object. The account is never taken from the page: the extension signs
with the current user and only the operation fields come from the dApp.

```js
vizonator.pm_place_bet({market_id:268633,side:1,outcome_index:0,amount:'12.500 VIZ',min_tokens:9000},function(response){
	//response.error === false on success
});
```

Available: `pm_oracle_register`, `pm_oracle_update`, `pm_create_market`, `pm_oracle_accept_market`,
`pm_place_bet`, `pm_commit_bet`, `pm_reveal_bet`, `pm_cancel_bet`, `pm_add_liquidity`,
`pm_withdraw_liquidity`, `pm_resolve_market`, `pm_no_contest`, `pm_dispute_create`,
`pm_dispute_vote`, `pm_dispute_resolve`, `pm_dispute_oracle_respond`, `pm_unban`,
`pm_transfer_position`, `pm_lazy_deposit`, `pm_lazy_withdraw`, `pm_leverage_open`,
`pm_leverage_close`, `pm_leverage_convert`.

Every operation is signed with the active key, except `pm_dispute_vote` (regular key), and gets its
own trustline entry — approving one operation for a site does not approve the rest. Required fields
are checked before the confirmation window opens; an omitted optional field of `pm_oracle_update`
stays absent on the wire ("leave as is") instead of being sent as a zero.

The table of operations, their fields and authorities lives in a single file, `pm_ops.js`, shared by
the background, the page and the confirmation window.

## Accounts for dApps

A dApp can ask which accounts the wallet holds and let the user pick one:

```js
vizonator.get_accounts(function(error,result){
	//result = {current:"on1x",accounts:[{login:"on1x",current:true,regular:true,active:true,memo:true}]}
});
vizonator.switch_account({account:"hub"},function(error,result){
	//result = {login:"hub",switched:true}
});
```

Only logins and key-presence flags are returned — private keys never leave the extension. The list
has its own trustline rule (`accounts`), so approving `get_account` does not open it.

A switch is **never silent**: the extension always shows a confirmation window with the current and
the requested account, and the decision is not remembered (`account_switch` is not saved as a rule),
otherwise a trusted site could move the wallet to an account the user never connected it to. Asking
for the already-current account is answered at once, without a window. An unknown login is refused
with `unknown_account`.

A page can also be told about a change instead of asking for it — and that includes a switch the
user made in the popup, not just a `switch_account` call:

```js
vizonator.on("accountsChanged",function(error,result){
	//result = same snapshot as get_accounts, or error = "no_rule"
});
vizonator.off("accountsChanged",handler);//no handlers left — the channel closes
```

The channel opens no window, but it hands nothing over either: data is delivered only to a site
whose `accounts` rule is already approved, otherwise the event arrives with `no_rule`. The
subscription lives as long as the page — a reload has to subscribe again.

## passwordless_auth and domains

`vizonator.passwordless_auth({authority:"regular"},callback)` signs
`domain:auth:account:authority:timestamp:nonce`. The optional `domain` field names the domain the
signature is asked for; without it the page's own host is signed, exactly as before.

For `http/https` a page may name its **own** host, and since **0.77** also its **main domain**: a
page on `app.example.com` may sign for `example.com`, as both belong to the same owner. The window
then shows an **orange warning** that the string goes to the main domain and not to the host the
page is open on, and such a request is never approved silently, not even when other operations are
already trusted for the site. Everything else is refused with `domain_mismatch` before any window
opens: a foreign domain, a main domain signing for a subdomain, and a subdomain signing for a
neighbouring subdomain. On platforms that hand subdomains out to anyone (`github.io`, `vercel.app`
and the like) the main domain is the subdomain itself — otherwise `evil.github.io` would sign for
everyone hosted there at once.

`viz://` names (VIZ DNS) are allowed from any page, but such a request is never auto-approved: the
user sees both the domain and the signing account in the window. The confirmation window always
shows the domain and the account, and a signature for an account the user did not see (switched
while the window was open) is refused with `account_changed`.

## Dependencies

* [Cash js](https://github.com/fabiospampinato/cash/)
* [viz-js-lib](https://github.com/VIZ-Blockchain/viz-js-lib/)

## Distribution

Zip all files and upload archive as extension package to browser marketplace:

* [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
* [Firefox Browser Add-ons](https://addons.mozilla.org/)

> Some social gates can be disabled due API or site parsing restrictions.

Promo images with sources (GIMP file format) available in `screenshot` directory.

### Commentary for reviewers:

Extension using open source libraries: Cash min (from https://github.com/fabiospampinato/cash/) and viz-js-lib min (from https://github.com/VIZ-Blockchain/viz-js-lib/tree/master/doc).

Each minify version downloaded manually from github https://github.com/fabiospampinato/cash/releases/tag/8.1.5 or npm packages on latest version from jsdeliver https://cdn.jsdelivr.net/npm/viz-js-lib@latest/dist/viz.min.js