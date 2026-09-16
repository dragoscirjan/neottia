{% extends "neottia.sdlc.layout" %}

{% block title %}Verify{% endblock %}

{% block purpose %}Evaluate the implementation against requirements and required checks.{% endblock %}

{% block sequence %}1. Compare the change with every requirement and stop condition. 2. Run the required checks and inspect user-visible and operational behavior. 3. Return failures to Build or present successful evidence for the release decision.{% endblock %}
