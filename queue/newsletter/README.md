# Newsletter issues waiting for the website

Subscribers get each issue first. Its web page waits here as `<YYYY-MM-DD>__<slug>.html` (the date it may
appear on myrobotisa.com: send date + 7) and the Thursday workflow `publish-newsletter.yml` moves it to
`docs/newsletter/<slug>.html` and lists it on the newsletter page. Each page needs `<title>`,
`<meta name="description">` (the one-line summary) and `<meta name="newsletter-sent" content="YYYY-MM-DD">`.
Nothing here is served: the site is built from `docs/` only.
