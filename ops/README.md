# ops

`lms_email.py` lives here because this is the only public repo in the estate.

The four project repos are private, so `raw.githubusercontent.com` returns 404
to the unauthenticated fetch a scheduled task makes — which meant the copy in
`points-per-pound/ops/` could never actually be loaded, and every email was
hand-written instead, silently losing the dark-mode fix it carries. Published
here, any task can fetch it:

    https://raw.githubusercontent.com/amitbharatpatel7-hue/ppp-assets/main/ops/lms_email.py

This is the copy tasks load. Change it here.
