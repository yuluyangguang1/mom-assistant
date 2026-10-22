"""回归测试用的固定种子数据（一位 5 月龄宝宝 10-05~10-11 的喂养/睡眠/尿布等）。由 shoot.py 抽出。"""
def T(d, hm): return f'2026-10-{d:02d}T{hm}'
feed = []; sleeps = []; diapers = []
import random; random.seed(3)
for d in range(5, 12):
    for hm in ['01:10', '04:30', '07:40', '10:50', '14:05', '17:20', '20:30']:
        if d == 11 and hm > '15:00': continue
        typ = random.choice(['breast', 'breast', 'bottle'])
        r = {'id': f'f{d}{hm}', 'type': typ, 'start': T(d, hm), 'durationMin': None, 'durationL': None, 'durationR': None, 'amount': None, 'amountBm': None, 'amountFm': None, 'side': None, 'note': None, 'newFood': None, 'dish': None, 'ing': None, 'steps': None}
        if typ == 'breast': r['durationL'] = random.choice([8, 10, 12]); r['durationR'] = random.choice([7, 9, 11]); r['durationMin'] = r['durationL'] + r['durationR']
        else: r['amount'] = random.choice([120, 140, 150]); r['amountBm'] = r['amount']
        feed.append(r)
    for a, b in [('21:30', '23:50'), ('00:20', '04:10'), ('04:50', '07:20'), ('09:30', '10:40'), ('13:00', '14:20'), ('16:30', '17:10')]:
        if d == 11 and a > '15:00': continue
        sleeps.append({'id': f's{d}{a}', 'start': T(d, a) + ':00', 'end': T(d, b) + ':00', 'pausedMs': 0, 'note': None, 'wakings': 0, 'longestMin': None})
    for hm in ['02:00', '06:30', '09:10', '12:40', '16:00', '19:30']:
        if d == 11 and hm > '15:00': continue
        diapers.append({'id': f'd{d}{hm}', 'type': random.choice(['wet', 'wet', 'dirty', 'both']), 'time': T(d, hm), 'note': None})
growth = [{'id': 'g1', 'date': '2026-05-20', 'weightKg': 3.3, 'heightCm': 50, 'headCm': 34}, {'id': 'g2', 'date': '2026-06-20', 'weightKg': 4.4, 'heightCm': 54.5, 'headCm': 37},
          {'id': 'g3', 'date': '2026-07-20', 'weightKg': 5.5, 'heightCm': 58, 'headCm': 39}, {'id': 'g4', 'date': '2026-08-20', 'weightKg': 6.3, 'heightCm': 61, 'headCm': 40.5}, {'id': 'g5', 'date': '2026-09-20', 'weightKg': 6.9, 'heightCm': 63.5, 'headCm': 41.5}]
temps = [{'id': 't1', 'time': T(10, '20:10'), 'value': 36.8, 'note': None}, {'id': 't2', 'time': T(11, '08:00'), 'value': 36.6, 'note': None}]
moods = [{'id': 'm1', 'time': T(11, '09:00'), 'level': 4, 'note': None, 'tags': []}]
seed = {'settings': {'privacyAccepted': True, 'onboardingDone': True, 'stage': 'baby', 'theme': 'light', 'themeAuto': False, 'caregiver': {'role': 'mom', 'name': '豆豆妈'},
                     'baby': {'sex': 'girl', 'birthDate': '2026-05-20', 'preterm': False, 'birthGestWeeks': 40, 'nickname': '豆豆'}, 'remindersEnabled': False},
        'feedings': feed, 'sleeps': sleeps, 'diapers': diapers, 'growth': growth, 'temps': temps, 'moods': moods}
