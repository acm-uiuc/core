# Extensions
Extensions allow additional functionality to be added ACM@UIUC Core without needing to be embedded with in Core's codebase. Exentions are primarly expected to leverage Core for authentication and authorization, but can utilize any of Core's publically exposed endpoints. The full list of exposed endpoint can be found in `design.md`. Below a very simple sample extension is provided to illustrate the bare minimum which needs to be done in order to properly interface with Core. This application allows users to login and have their use information displayed to them.

## Sample Extension
```python
from flask import Flask, redirect, request
import requests
import json


app = Flask(__name__)


CORE_BASE_URI = 'https://acm.illinois.edu/'
LOGIN_BASE_URI = f'{CORE_BASE_URI}/api/auth/google'
AUTHENTICATE_BASE_URI = f'{CORE_BASE_URI}/api/auth/google'
USER_BASE_URI = f'{CORE_BASE_URI}/api/user'


@app.route('/')
def home():
	return (
		'This is a sample extension for ACM@UIUC Core. ' + 
		'Start by visting to /login to authenticate with Core. ' + 
		'Once authenticated you will be directed to a page with your user info.'
	)

@app.route('/login')
def login():
	return redirect( f'{LOGIN_BASE_URI}?target=http://127.0.0.1:5000/user', code=302)

@app.route('/user')
def user():
	body = {
		'code': request.args.get('code')
	}
	headers = {
		'Content-Type': 'application/json'
	}
	resp = requests.post(f'{AUTHENTICATE_BASE_URI}', json=body, headers=headers)
	data = resp.json()
	headers['Authorization'] = data['token']
	resp = requests.get(f'{USER_BASE_URI}', headers=headers)
	data = resp.json()
	return json.dumps(data)

if __name__ == '__main__':
	app.run(host='127.0.0.1', port=5000)

```
