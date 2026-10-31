"""切图批次配置：SET=336 / 337（环境变量），默认 336。
总表 png 不入库（各 1.5MB）：336 = tools/sheet_v4.png（第 336 次用户上传），337 = /workspace/uploads/DC1468DF-….png 复制到 tools/sheet_337.png。
用法：cd tools/icons_v4 && SET=337 python3 detect.py && SET=337 python3 cut.py && SET=337 python3 build.py out_337 && SET=337 python3 check.py out_337 check.jpg
第 337 次新增：bgfit（底块带渐变时用环带拟合二次曲面当局部底色）、close_bottom（身体画到底块下沿、没底边轮廓的，补线填洞收回皮肤）。"""
import os
SET = os.environ.get('SET', '336')
SETS = {
    '336': dict(sheet='../sheet_v4.png', tiles='tiles.json', meta='meta.json',
                names=['baby','breast','bottle','pump','solid','diaper','sleep','growth','vaccine','meds','temp','sick',
                       'jaundice','bath','swim','sun','water','fetal','prenatal','packing','mom','mood','period','contraction',
                       'home','calendar','noise','search','settings','family'],
                th={'breast':6.5,'prenatal':7,'mom':7,'mood':7}),
    '337': dict(sheet='../sheet_337.png', tiles='tiles_337.json', meta='meta_337.json', bgfit=True, close_bottom={'jaundice','breast'},
                # 前 4 个替换 v4 旧图；dkhome / dkcal / dkbaby 是 dock 三颗（dock.py 另出 assets/dock/），不进 v4 目录
                names=['baby','breast','contraction','jaundice','pee','poop','milestone','supplement','pregnancy','momweight','finance','supplies',
                       'dkhome','dkcal','dkbaby','alltools','edit','quick','cards','appearance','weather','reminder','haptic','transfer',
                       'tofamily','privacy','sources','checkup','birthday','routine'],
                skip_build=('dkhome','dkcal','dkbaby')),
}
CFG = SETS[SET]
