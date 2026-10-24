---
'@cuped-io/flame': patch
---

E-commerce detection now records newsletter signups and searches. Their built-in selectors name the submit button inside the form, and flame only tested the form itself, so with `data-ecommerce="true"` those two goals almost never fired. A form submit is now matched against the button that submitted it as well.
