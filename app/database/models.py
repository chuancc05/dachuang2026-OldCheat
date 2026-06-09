from datetime import datetime
from sqlalchemy import Boolean, Column, Integer, String, Float, Text, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class User(Base):
    """用户模型"""
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    voice_calibration_params = Column(Text, nullable=True)
    preferred_difficulty = Column(String(20), nullable=True)

    # 级联删除用户的培训会话记录
    sessions = relationship('TrainingSession', back_populates='user', cascade='all, delete-orphan')


class TrainingSession(Base):
    """培训会话模型"""
    __tablename__ = 'training_sessions'

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    start_time = Column(DateTime, default=datetime.now)
    end_time = Column(DateTime, nullable=True)
    topic = Column(String(255), nullable=True)
    scene_type = Column(String(50), nullable=True)
    difficulty = Column(String(20), nullable=True)
    total_rounds = Column(Integer, default=0)
    identified_fraud = Column(Boolean, nullable=True)
    pdf_report_path = Column(Text, nullable=True)

    user = relationship('User', back_populates='sessions')
    # 级联删除会话对应的对话记录和评分记录
    dialogues = relationship('DialogueDetail', back_populates='session', cascade='all, delete-orphan')
    scores = relationship('PsychologicalScore', back_populates='session', cascade='all, delete-orphan')


class DialogueDetail(Base):
    """对话详情模型"""
    __tablename__ = 'dialogue_details'

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey('training_sessions.id'), nullable=False)
    round_number = Column(Integer, nullable=False, default=0)
    speaker = Column(String(50), nullable=False)  # 例如: 'user' 或 'ai'
    content = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=datetime.now)

    session = relationship('TrainingSession', back_populates='dialogues')


class PsychologicalScore(Base):
    """心理评分和反馈模型"""
    __tablename__ = 'psychological_scores'

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey('training_sessions.id'), nullable=False)
    round_number = Column(Integer, nullable=False, default=0)
    e01_score = Column(Float, nullable=True)
    e02_score = Column(Float, nullable=True)
    e03_score = Column(Float, nullable=True)
    l01_score = Column(Float, nullable=True)
    l02_score = Column(Float, nullable=True)
    l03_score = Column(Float, nullable=True)
    c01_score = Column(Float, nullable=True)
    c02_score = Column(Float, nullable=True)
    c03_score = Column(Float, nullable=True)
    s01_score = Column(Float, nullable=True)
    s02_score = Column(Float, nullable=True)
    s03_score = Column(Float, nullable=True)
    composite_score = Column(Float, nullable=True)
    activated_dimensions = Column(Text, nullable=True)
    feedback_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now)

    session = relationship('TrainingSession', back_populates='scores')
