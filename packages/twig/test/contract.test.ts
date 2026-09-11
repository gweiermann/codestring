import { runAdapterContractSuite } from "@codestring/testing";
import { twigAdapter } from "@codestring/twig";

runAdapterContractSuite(twigAdapter, {
  valid: [
    "plain text",
    "{{ user.name }}",
    "{# a comment #}",
    "{% block content %}hello{% endblock %}",
    "{% if a %}{% for x in y %}{{ x }}{% endfor %}{% endif %}",
    "{% set count = 1 %}",
    "{%- block trimmed -%}x{%- endblock -%}",
    "{% verbatim %}{{ not twig }}{% endverbatim %}",
  ],
  malformed: [
    "{% block missing %}",
    "{% endblock %}",
    "{{ unclosed",
    "{# unclosed comment",
    "{% block a %}{% endfor %}",
  ],
  unicode: ["{{ '🎉' }}", "{% block 🎉 %}x{% endblock %}", "text 🎉 {{ x }}"],
  placeholderContexts: [
    { before: "{% block ", after: " %}{% endblock %}" },
    { before: "{% block x %}", after: "{% endblock %}" },
    { before: "{{ ", after: " }}" },
    { before: "{% if ", after: " %}{% endif %}" },
  ],
});
