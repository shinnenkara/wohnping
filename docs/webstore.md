# Chrome Web Store

Dashboard record for Wohnping. This file is the source for the store listing and the privacy form. The public privacy page is [privacy.html](privacy.html). When behavior changes, update both, then paste this file into the developer dashboard before the next upload.

Stand 3. November 2026. Package version in the repo is 1.1.0. The console copy from Oktober 2026 still says Wohnping never clicks Send and only reloads the search about once a minute. That text is behind the product.

## Listing

Language: German. Category: Tools. Mature content: off.

Homepage: https://github.com/shinnenkara/wohnping

Privacy policy: https://github.com/shinnenkara/wohnping/blob/main/docs/privacy.html

Support URL: empty. Official URL: none. Promo video and promo tiles: empty. Two screenshots and the 128×128 icon stay as uploaded.

Summary comes from the package `description`:

Überwacht eine gespeicherte ImmobilienScout24-Suche und füllt das Kontaktformular. Automatisches Senden ist optional und bleibt lokal.

Description:

```
Wohnping merkt sich eine Suchseite und lädt sie in einem eigenen Tab etwa alle ein bis fünf Minuten neu. Erscheint ein neues Inserat, bekommst du eine Benachrichtigung und kannst es in einem neuen Tab öffnen.

Auf der Inseratsseite füllt Wohnping das Kontaktformular aus dem Profil, das du in den Einstellungen speicherst. Name, Kontakt, Adresse und die weiteren Angaben bleiben lokal im Browser. Automatisches Senden ist aus, bis du es einschaltest. Dann klickt Wohnping die Senden-Schaltfläche der Seite, höchstens bis zu deinem Tageslimit. Sonst prüfst du das Formular und sendest selbst.

So startest du:
1. Öffne eine Suche auf immobilienscout24.de und kopiere die Adresse.
2. Trage die Such-URL und dein Profil in den Einstellungen ein.
3. Starte die Überwachung. Es bleibt ein Tab für diese Suche. Die Nachrichtenliste kann in einem zweiten Tab mitlaufen.
4. Bei einem neuen Inserat die Seite öffnen, das ausgefüllte Formular prüfen und selbst senden, oder Auto-Senden eingeschaltet lassen.

Wohnping ist unabhängig und nicht mit Scout24 oder ImmobilienScout24 verbunden. Es löst kein Captcha und ruft keine private Schnittstelle von ImmoScout auf.
```

## Privacy form

Single purpose:

Watch one saved ImmobilienScout24 search, notify the user about new listings, fill the contact form from a profile stored in the browser, and submit that form only when the user turns auto-send on. The user can still review and send each message.

Permission justifications:

- storage: The storage permission keeps the profile, saved search URL, watch and auto-send settings (including the daily cap and today's send count), detected listings and their contact-request status, opened-listing details, and messenger status in chrome.storage on the device. Messenger status is who wrote last, the date, and message counts, not the message text. Wohnping does not upload that data to a developer server.
- alarms: The alarms permission reloads the pinned search tab about every one to five minutes while monitoring is on, and the pinned conversations tab about every 15 to 30 minutes, so new listings and replies can be detected. Both alarms are removed when the user pauses or stops monitoring.
- notifications: The notifications permission shows a desktop notification for a new listing, when an auto-send needs the user, and when the daily auto-send cap is reached. Choosing a listing notification opens that listing. Notification content is not sent to a server.
- tabs: The tabs permission opens and reloads the pinned search tab and the pinned conversations tab, copies the URL of an open ImmobilienScout24 tab when the user asks for that, and messages the active listing tab when the user asks to fill the contact form.
- host: Host access is limited to immobilienscout24.de. Content scripts read the saved search to detect new listings, read an open listing for popup details, fill the contact form from the locally stored profile, and click the page's send button only when auto-send is on. On an open messenger thread they record who wrote last, the date, and message counts, not the message text. On the conversations list they match addresses and status so a request can be marked sent or answered. The extension does not access other sites.

Remote code: no.

Data the form says is collected:

- Personally identifiable information (name, email, phone, address in the profile)
- Financial and payment information (monthly net household income in the profile)
- Website content (search results, listing details, conversation status)

Leave unchecked: health information, authentication information, personal communications, location, web history, user activity. Message text is read on the page only to tell a reply from a system note, and it is not stored.

All three certifications stay checked: no sale or transfer outside the approved use cases, no use unrelated to the single purpose, no use for creditworthiness or lending.

Google Analytics is not opted in.
