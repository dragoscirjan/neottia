{% extends "neottia.sdlc.layout" %}

{% block title %}Plan{% endblock %}

{% block purpose %}Turn the request and repository evidence into a bounded implementation plan.{% endblock %}

{% block sequence %}1. Read the request, tracked work, relevant documents, configuration, and repository state. 2. Identify requirements, dependencies, risks, affected code, and validation evidence. 3. Record the proposed work and stop for the required scope approval.{% endblock %}
